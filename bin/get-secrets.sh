#!/usr/bin/env node
var AWS = require('aws-sdk');
const s3 = new AWS.S3()

# TODO pass in credentials as specific ENVARS, as we can't overwrite the ones used by riffraff in the TeamCity CI
var bucket = process.argv[2];

s3.getObject({
	Bucket: bucket,
	Key: 'config.json'
}, function (err, data) {
	if (err) {
		console.error(err);
		process.exit(1);
	} else {
		console.log(data.Body.toString('utf8'));
		process.exit(0);
	}
});
