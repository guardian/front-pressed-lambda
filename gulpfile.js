var gulp = require('gulp');
var yaml = require('gulp-yaml');
var zip = require('gulp-zip');
process.env.ARTEFACT_PATH = __dirname;
var riffraff = require('node-riffraff-artefact');
var path = require('path');

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
    return gulp.src('deploy.yml')
        .pipe(yaml({ space: 4 }))
        .pipe(gulp.dest('tmp/riffraff'));
});

gulp.task('archive', function () {
    return gulp.src(['tmp/lambda/index.js'])
        .pipe(zip('artifact.zip'))
        .pipe(gulp.dest('tmp/riffraff/packages/lambda'))
        .pipe(gulp.dest('tmp/riffraff/packages/s3'));
});

gulp.task('package', ['archive', 'riffraff'], function () {
    return gulp.src(['tmp/riffraff/**/*'])
        .pipe(zip('artifacts.zip'))
        .pipe(gulp.dest('tmp'));
});

gulp.task('deploy', function (cb) {
    riffraff.settings.leadDir = path.join(__dirname, 'tmp/');

    riffraff.s3Upload().then(function () {
        cb();
    }).catch(function (error) {
        cb(error);
    });
});