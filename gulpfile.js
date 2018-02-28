var gulp = require('gulp');
var yaml = require('gulp-yaml');
process.env.ARTEFACT_PATH = __dirname;
var riffraff = require('node-riffraff-artefact');
var path = require('path');
var exec  = require('exec-chainable');

gulp.task('compile', function () {
  return exec('rollup -c rollup.config.js');
});

gulp.task('deploy', ['compile'], function (cb) {
    riffraff.settings.leadDir = path.join(__dirname, 'tmp/');

    riffraff.s3FilesUpload()
    .then(cb)
    .catch(cb)
});

