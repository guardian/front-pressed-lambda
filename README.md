Store front pressed information

### Architecture

Facia press continuously presses new fronts and sends Kinesis update on the status.

This lambda, living in the frontend account, listens to Kinesis and store last press date in a Dynamo DB table in the cms-fronts account.
If the error count is above a threshold, it sends an alert mail via pagerduty.


### Unit tests

Install depencies by running `npm install`

Ensure you are using the correct version of node (node 6)
If you have nvm installed, you can just run `nvm use`.

You need credentials for the frontend account to run the tests.
Export the crendentials by running `export AWS_PROFILE=frontend`

The lambda fetches secrets from an S3 bucket.

Set the bucket name with

```
export FRONT_PRESSED_LAMBDA_BUCKET="bucket-name"
```

* `npm test` to run your tests once.
* `nodemon --exec 'npm test' --ignore tmp` to watch your files and run tests on save.
