var extract = require('../')
var fs = require('fs')
var path = require('path')
var rimraf = require('rimraf')
var temp = require('temp').track()
var test = require('tape')

var catsZip = path.join(__dirname, 'cats.zip')
var githubZip = path.join(__dirname, 'github.zip')
var subdirZip = path.join(__dirname, 'file-in-subdir-without-subdir-entry.zip')
var symlinkDestZip = path.join(__dirname, 'symlink-dest.zip')
var symlinkZip = path.join(__dirname, 'symlink.zip')
var entryErrorZip = path.join(__dirname, 'entry-error.zip')
var brokenZip = path.join(__dirname, 'broken.zip')

var relativeTarget = './cats'

function mkdtemp (t, suffix, callback) {
  temp.mkdir({prefix: 'extract-zip', suffix: suffix}, function (err, dirPath) {
    t.notOk(err, 'no error when creating temporary directory')
    callback(dirPath)
  })
}

function tempExtract (t, suffix, zipPath, callback) {
  mkdtemp(t, suffix, function (dirPath) {
    extract(zipPath, {dir: dirPath}, function (err) {
      t.notOk(err, 'no error when extracting ' + zipPath)

      callback(dirPath)
    })
  })
}

function extractWithOptions (t, suffix, zipPath, options, callback) {
  mkdtemp(t, suffix, function (dirPath) {
    options = options || {}
    options.dir = dirPath
    extract(zipPath, options, function (err) {
      t.notOk(err, 'no error when extracting ' + zipPath)

      callback(dirPath)
    })
  })
}

function relativeExtract (callback) {
  rimraf.sync(relativeTarget)
  extract(catsZip, {dir: relativeTarget}, callback)
  rimraf.sync(relativeTarget)
}

test('files', function (t) {
  t.plan(3)

  tempExtract(t, 'files', catsZip, function (dirPath) {
    t.true(fs.existsSync((path.join(dirPath, 'cats', 'gJqEYBs.jpg'))), 'file created')
  })
})

test('dry run', function (t) {
  t.plan(3)

  extractWithOptions(t, 'files', catsZip, { dryRun: true }, function (dirPath) {
    t.false(fs.existsSync((path.join(dirPath, 'cats', 'gJqEYBs.jpg'))), 'file created')
  })
})

test('ignore path errors', function (t) {
  t.plan(4)

  extractWithOptions(t, 'files', entryErrorZip, { ignoreInvalidPaths: true }, function (dirPath) {
    t.true(fs.existsSync((path.join(dirPath, 'valid.txt'))), 'file created')
    t.false(fs.existsSync('/test/error.txt'), 'file created')
  })
})

test('symlinks', function (t) {
  t.plan(5)

  tempExtract(t, 'symlinks', catsZip, function (dirPath) {
    var symlink = path.join(dirPath, 'cats', 'orange_symlink')

    t.true(fs.existsSync(symlink), 'symlink created')

    fs.lstat(symlink, function (err, stats) {
      t.same(err, null, 'symlink can be stat\'d')
      t.ok(stats.isSymbolicLink(), 'symlink is valid')
    })
  })
})

test('directories', function (t) {
  t.plan(8)

  tempExtract(t, 'directories', catsZip, function (dirPath) {
    var dirWithContent = path.join(dirPath, 'cats', 'orange')
    var dirWithoutContent = path.join(dirPath, 'cats', 'empty')

    t.true(fs.existsSync(dirWithContent), 'directory created')

    fs.readdir(dirWithContent, function (err, files) {
      t.same(err, null, 'directory can be read')
      t.ok(files.length > 0, 'directory has files')
    })

    t.true(fs.existsSync(dirWithoutContent), 'empty directory created')

    fs.readdir(dirWithoutContent, function (err, files) {
      t.same(err, null, 'empty directory can be read')
      t.ok(files.length === 0, 'empty directory has no files')
    })
  })
})

test('verify github zip extraction worked', function (t) {
  t.plan(3)

  tempExtract(t, 'verify-extraction', githubZip, function (dirPath) {
    t.true(fs.existsSync((path.join(dirPath, 'extract-zip-master', 'test'))), 'folder created')
  })
})

test('callback called once', function (t) {
  t.plan(4)

  tempExtract(t, 'callback', symlinkZip, function (dirPath) {
    // this triggers an error due to symlink creation
    extract(symlinkZip, {dir: dirPath}, function (err) {
      if (err) t.ok(true, 'error passed')

      t.ok(true, 'callback called')
    })
  })
})

test('relative target directory', function (t) {
  t.plan(2)

  relativeExtract(function (err) {
    t.true(err instanceof Error, 'is native V8 error')
    t.same(err.message, 'Target directory is expected to be absolute', 'has descriptive error message')
  })
})

test('no folder created', function (t) {
  t.plan(2)

  relativeExtract(function (err) {
    t.true(err instanceof Error, 'is native V8 error')
    t.false(fs.existsSync(path.join(__dirname, relativeTarget)), 'file not created')
  })
})

test('symlink destination disallowed', function (t) {
  t.plan(4)

  mkdtemp(t, 'symlink-destination-disallowed', function (dirPath) {
    t.false(fs.existsSync(path.join(dirPath, 'file.txt')), 'file doesn\'t exist at symlink target')

    extract(symlinkDestZip, {dir: dirPath}, function (err) {
      t.true(err instanceof Error, 'is native V8 error')

      if (err) {
        var regex = /Out of bound path .* found while processing file symlink-dest\/aaa\/file\.txt/
        t.true(regex.test(err.message), 'has descriptive error message')
      }
    })
  })
})

test('no file created out of bound', function (t) {
  t.plan(7)

  mkdtemp(t, 'out-of-bounds-file', function (dirPath) {
    extract(symlinkDestZip, {dir: dirPath}, function (err) {
      var symlinkDestDir = path.join(dirPath, 'symlink-dest')

      t.true(err instanceof Error, 'is native V8 error')
      t.true(fs.existsSync(symlinkDestDir), 'target folder created')
      t.true(fs.existsSync(path.join(symlinkDestDir, 'aaa')), 'symlink created')
      t.true(fs.existsSync(path.join(symlinkDestDir, 'ccc')), 'parent folder created')
      t.false(fs.existsSync(path.join(symlinkDestDir, 'ccc/file.txt')), 'file not created in original folder')
      t.false(fs.existsSync(path.join(dirPath, 'file.txt')), 'file not created in symlink target')
    })
  })
})

test('files in subdirs where the subdir does not have its own entry is extracted', function (t) {
  t.plan(3)

  tempExtract(t, 'subdir-file', subdirZip, function (dirPath) {
    t.true(fs.existsSync(path.join(dirPath, 'foo', 'bar')), 'file created')
  })
})

test('extract broken zip', function (t) {
  t.plan(2)

  mkdtemp(t, 'broken-zip', function (dirPath) {
    extract(brokenZip, {dir: dirPath}, function (err) {
      t.ok(err, 'Error: invalid central directory file header signature: 0x2014b00')
    })
  })
})

test('zipfile entry error is caught and optional onEntryError callback is called', function (t) {
  t.plan(6)

  mkdtemp(t, 'entry-error', function (dirPath) {
    function onEntryError (err, zipfile) {
      t.true(err instanceof Error, 'error is passed to onEntryError callback')
      t.ok(zipfile, 'zipfile is passed to onEntryError callback')
    }

    extract(entryErrorZip, {dir: dirPath, onEntryError: onEntryError}, function (err) {
      t.notOk(err, 'no error when extracting ' + entryErrorZip)

      t.true(fs.existsSync(path.join(dirPath, 'valid.txt')), 'valid file created')
      t.false(fs.existsSync(path.join(dirPath, 'test/error.txt')), 'error file not created')
    })
  })
})
