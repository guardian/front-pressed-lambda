var gulp = require('gulp');
var yaml = require('gulp-yaml');
var babel = require('gulp-babel');
var zip = require('gulp-zip');

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

gulp.task('lambda-compile', function () {
    return gulp.src('lambda/*.js')
        .pipe(babel())
        .pipe(gulp.dest('tmp/lambda'));
});

gulp.task('lambda-copy-deps', function () {
    return gulp.src('node_modules/lambda-elasticsearch/index.js')
        .pipe(gulp.dest('tmp/lambda/lambda-elasticsearch'));
});

gulp.task('lambda-archive', ['lambda-compile', 'lambda-copy-deps'], function () {
    return gulp.src('tmp/lambda/**/*')
        .pipe(zip('artifact.zip'))
        .pipe(gulp.dest('tmp/riffraff/packages/lambda'))
        .pipe(gulp.dest('tmp/riffraff/packages/curator'));
});
