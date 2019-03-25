var fs = require('fs')
var path = require('path')
var yauzl = require('yauzl-mac')
var mkdirp = require('mkdirp')
var concat = require('concat-stream')
var debug = require('debug')('extract-zip')

module.exports = function (zipPath, opts, cb) {
  var invalidPathRegex = /^(invalid characters in fileName: )|(absolute path: )|(invalid relative path: )/

  debug('creating target directory', opts.dir)

  if (path.isAbsolute(opts.dir) === false) {
    return cb(new Error('Target directory is expected to be absolute'))
  }

  mkdirp(opts.dir, function (err) {
    if (err) return cb(err)

    fs.realpath(opts.dir, function (err, canonicalDir) {
      if (err) return cb(err)

      opts.dir = canonicalDir

      openZip(opts)
    })
  })

  function openZip () {
    debug('opening', zipPath, 'with opts', opts)

    var errorFilter = function (err) {
      if (!err || !err.message || !opts.ignoreInvalidPaths) {
        return true
      }

      return !invalidPathRegex.test(err.message)
    }

    yauzl.open(zipPath, {
      supportMacArchiveUtility: opts.supportMacArchiveUtility,
      lazyEntries: true,
      autoClose: false,
      errorFilter: errorFilter
    },
    function (err, zipfile) {
      if (err) return cb(err)

      var cancelled = false
      zipfile.once('end', function () {
        debug('zipfile end event')
        zipfile.close()
      })

      zipfile.on('error', function (err) {
        debug('zipfile error', {error: err})

        if (errorFilter(err)) {
          if (!opts.onEntryError || opts.onEntryError(err, zipfile)) {
            cancelled = true
            zipfile.close()
            return cb(err)
          }
        }

        debug('zipfile error ignored, reading next entry')
        zipfile.emittedError = false
        zipfile.readEntry()
      })
      zipfile.readEntry()

      zipfile.on('close', function () {
        if (!cancelled) {
          debug('zip extraction complete')
          cb()
        }
      })

      zipfile.on('entry', function (entry) {
        if (cancelled) {
          debug('skipping entry', entry.fileName, {cancelled: cancelled})
          return
        }

        debug('zipfile entry', entry.fileName)

        if (/^__MACOSX\//.test(entry.fileName)) {
          // dir name starts with __MACOSX/
          zipfile.readEntry()
          return
        }

        var destDir = path.dirname(path.join(opts.dir, entry.fileName))

        mkdirp(destDir, function (err) {
          if (err) {
            cancelled = true
            zipfile.close()
            return cb(err)
          }

          fs.realpath(destDir, function (err, canonicalDestDir) {
            if (err) {
              cancelled = true
              zipfile.close()
              return cb(err)
            }

            var relativeDestDir = path.relative(opts.dir, canonicalDestDir)

            if (relativeDestDir.split(path.sep).indexOf('..') !== -1) {
              cancelled = true
              zipfile.close()
              return cb(new Error('Out of bound path "' + canonicalDestDir + '" found while processing file ' + entry.fileName))
            }

            extractEntry(entry, function (err) {
              // if any extraction fails then abort everything
              if (err) {
                cancelled = true
                zipfile.close()
                return cb(err)
              }
              debug('finished processing', entry.fileName)
              zipfile.readEntry()
            })
          })
        })
      })

      function extractEntry (entry, done) {
        if (cancelled) {
          debug('skipping entry extraction', entry.fileName, {cancelled: cancelled})
          return setImmediate(done)
        }

        if (opts.onEntry) {
          opts.onEntry(entry, zipfile)
        }

        var dest = path.join(opts.dir, entry.fileName)

        // convert external file attr int into a fs stat mode int
        var mode = (entry.externalFileAttributes >> 16) & 0xFFFF
        // check if it's a symlink or dir (using stat mode constants)
        var IFMT = 61440
        var IFDIR = 16384
        var IFLNK = 40960
        var symlink = (mode & IFMT) === IFLNK
        var isDir = (mode & IFMT) === IFDIR

        // Failsafe, borrowed from jsZip
        if (!isDir && entry.fileName.slice(-1) === '/') {
          isDir = true
        }

        // check for windows weird way of specifying a directory
        // https://github.com/maxogden/extract-zip/issues/13#issuecomment-154494566
        var madeBy = entry.versionMadeBy >> 8
        if (!isDir) isDir = (madeBy === 0 && entry.externalFileAttributes === 16)

        // if no mode then default to default modes
        if (mode === 0) {
          if (isDir) {
            if (opts.defaultDirMode) mode = parseInt(opts.defaultDirMode, 10)
            if (!mode) mode = 493 // Default to 0755
          } else {
            if (opts.defaultFileMode) mode = parseInt(opts.defaultFileMode, 10)
            if (!mode) mode = 420 // Default to 0644
          }
        }

        debug('extracting entry', { filename: entry.fileName, isDir: isDir, isSymlink: symlink })

        // reverse umask first (~)
        var umask = ~process.umask()
        // & with processes umask to override invalid perms
        var procMode = mode & umask

        // always ensure folders are created
        var destDir = dest
        if (!isDir) destDir = path.dirname(dest)
        if (opts.dryRun) return done()

        debug('mkdirp', {dir: destDir})
        mkdirp(destDir, function (err) {
          if (err) {
            debug('mkdirp error', destDir, {error: err})
            cancelled = true
            return done(err)
          }

          if (isDir) return done()

          debug('opening read stream', dest)
          zipfile.openReadStream(entry, function (err, readStream) {
            if (err) {
              debug('openReadStream error', err)
              cancelled = true
              return done(err)
            }

            readStream.on('error', function (err) {
              console.log('read err', err)
            })

            if (symlink) writeSymlink()
            else writeStream()

            function writeStream () {
              var outStream = fs.createWriteStream(dest, {mode: procMode})
              readStream.pipe(outStream)

              outStream.on('finish', function () {
                done()
              })

              outStream.on('error', function (err) {
                if (err.code === 'EACCES') {
                  debug('EACCESS error while writing ' + dest + ' attempting to chmod and retry', {error: err})
                  return fs.chmod(dest, '777', function (err) {
                    if (err) {
                      debug('chmod error', {error: err})
                      cancelled = true
                      return done(err)
                    }

                    writeStream()
                  })
                }

                debug('write error', {error: err})
                cancelled = true
                return done(err)
              })
            }

            // AFAICT the content of the symlink file itself is the symlink target filename string
            function writeSymlink () {
              readStream.pipe(concat(function (data) {
                var link = data.toString()
                debug('creating symlink', link, dest)
                fs.symlink(link, dest, function (err) {
                  if (err && err.code === 'EEXIST') {
                    return fs.unlink(dest, function (err) {
                      if (!err) {
                        return fs.symlink(link, dest, function (err) {
                          if (err) cancelled = true
                          done(err)
                        })
                      }
                      cancelled = true
                      done(err)
                    })
                  }
                  if (err) cancelled = true
                  done(err)
                })
              }))
            }
          })
        })
      }
    })
  }
}
