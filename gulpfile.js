var gulp = require('gulp');
var yaml = require('gulp-yaml');

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

