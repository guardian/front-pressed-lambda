#!/usr/bin/env node
var AWS = require('aws-sdk');
const s3 = new AWS.S3({
    region: 'eu-west-1',
    credentials: new AWS.SharedIniFileCredentials({ profile: 'cmsFronts' }),
})


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
