#!/usr/bin/env node

var extract = require('./')

var args = process.argv.slice(2)
var source = args[0]
var dest = args[1] || process.cwd()
var dryRun = process.env.EXTRACT_ZIP_DRY_RUN === 'true'
var ignoreInvalidPaths = process.env.EXTRACT_ZIP_IGNORE_INVALID_PATHS === 'true'

if (!source) {
  console.error('Usage: extract-zip foo.zip <targetDirectory>')
  process.exit(1)
}

extract(source, {dir: dest, dryRun: dryRun, ignoreInvalidPaths: ignoreInvalidPaths}, function (err) {
  if (err) {
    console.error('error!', err)
    process.exit(1)
  } else {
    process.exit(0)
  }
})
