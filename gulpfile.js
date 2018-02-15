var gulp = require('gulp');
var yaml = require('gulp-yaml');
process.env.ARTEFACT_PATH = __dirname;
var riffraff = require('node-riffraff-artefact');
var path = require('path');
var exec  = require('exec-chainable');

/* Cloudformation tasks */

gulp.task('default', ['cloudformation']);
gulp.task('dev', ['cloudformation-dev']);

gulp.task('cloudformation', function () {
    return gulp.src('cloudformation/*.yml')
        .pipe(yaml({ space: 4 }))
        .pipe(gulp.dest('./tmp/riffraff/packages/cloudformation'));
});

gulp.task('cloudformation-dev', ['cloudformation'], function () {
    gulp.watch('cloudformation/*.yml', ['cloudformation']);
});

gulp.task('riffraff', function () {
    return gulp.src('riff-raff.yaml')
        .pipe(yaml({ space: 4 }))
        .pipe(gulp.dest('tmp/riffraff'));
});

gulp.task('compile', function () {
  return exec('rollup -c rollup.config.js');
});

gulp.task('deploy', ['compile'], function (cb) {
    riffraff.settings.leadDir = path.join(__dirname, 'tmp/');

    riffraff.s3FilesUpload()
    .then(cb)
    .catch(cb)
});

