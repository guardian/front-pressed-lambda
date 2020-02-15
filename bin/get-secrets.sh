#!/usr/bin/env node

process.env.AWS_ACCESS_KEY_ID = process.env.SECRETS_AWS_ACCESS_KEY_ID
process.env.AWS_SECRET_ACCESS_KEY = process.env.SECRETS_AWS_SECRET_ACCESS_KEY

var AWS = require('aws-sdk');
const s3 = new AWS.S3()

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
