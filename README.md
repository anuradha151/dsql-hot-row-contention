# Aurora DSQL inventory buckets

By **Anuradha Ranasinghe**.

A small JavaScript CDK demo using API Gateway, Lambda and Aurora DSQL. It demonstrates distributing inventory updates across four rows and compares two ways to select and decrement a bucket.

This is an educational stock-decrement example. A checkout or reservation system would also need order handling, idempotency and other application rules.

## The example

One table, `inventory.buckets`, uses `(product_id, bucket_id)` as its primary key.

The demo has one product, `bucketed`, with four bucket rows holding 10 units each (40 total).

A transaction reads the available buckets, picks one at random and decrements it by one. The connector retries the whole transaction on an OCC conflict, using its defaults: up to three retries after the first attempt, with backoff and jitter. Each retry reads the available buckets again.

Stock reads sum the bucket rows. There is no separate total row to update. These are logical buckets in one database; they do not guarantee separate physical storage shards.

## Two ways to decrement

Each approach has its own Lambda and endpoint:

| Endpoint | Lambda folder | Bucket selection |
| --- | --- | --- |
| `POST /decrement` | `function/restApi/inventory/decrement/` | SELECT available IDs, choose in JavaScript, then UPDATE |
| `POST /decrement-single-query` | `function/restApi/inventory/decrementSingleQuery/` | One UPDATE with random bucket selection in a subquery |

Both return the same response shape and use the connector's default transaction retries. Both keep BEGIN and COMMIT; the combined statement removes one query round trip on a successful decrement. It still reads candidates inside the database, and conflicts remain possible. Deploy once to add both endpoints; switching tests requires only a different URL.

Reset stock between comparisons and keep all other settings equal. Both endpoints passed live functional checks and a 60-request test at concurrency 5, with 40 successful decrements and no overselling in each run. These small runs do not establish a consistent performance advantage; inspect query plans and repeat controlled tests before making that claim.

Always choosing the first available bucket sends competing requests to the same row. Random selection spreads writes across available buckets, although two requests can still choose the same bucket.

The two approaches let you compare application readability, query round trips and database work. Which approach would you choose for this case, and why?

## Install and deploy

Use Node.js 24, AWS CLI v2 and your own named AWS profile. Run these commands from this directory, replacing the placeholders:

```sh
npm ci
```

This installs the CDK dependencies and each Lambda's dependencies. Bootstrap your chosen account and Region once if needed:

```sh
npx cdk bootstrap aws://YOUR_ACCOUNT_ID/YOUR_REGION --profile YOUR_PROFILE --region YOUR_REGION
```

Deploy:

```sh
npx cdk deploy DsqlInventoryDemo --profile YOUR_PROFILE --region YOUR_REGION
```

Deployment creates the table, database roles and initial stock. Redeploying preserves existing stock. The outputs include `ApiUrl` and `SetupFunction`.

You can delete the demo after trying it with `cdk destroy`. The [cleanup steps](#delete-the-demo) below explain what is removed and what remains.

The API is public and has no application authentication. Database access uses IAM: the stock reader has SQL `SELECT` permission, both writers have `SELECT, UPDATE`, and the private setup function uses the database admin role. Run this in a disposable test environment. AWS resources incur charges.

## Test with Postman from the CLI

Install Newman once:

```sh
npm install -g newman@6.2.2
```

Use the deployed `ApiUrl` without a trailing slash:

```sh
npm run api-test -- --env-var baseUrl=https://YOUR_API.execute-api.YOUR_REGION.amazonaws.com/demo
```

The collection first checks the stock-setting endpoint, including zero, repeated assignment and invalid input, then sets every bucket to 10. Each decrement folder consumes one unit and verifies stock totals and rejected requests. Running the full collection leaves 38 units. Run without other callers or load tests. Saved error examples are illustrative; the collection does not force database errors.

## Send concurrent requests

[ApacheBench (`ab`)](https://httpd.apache.org/docs/2.4/programs/ab.html) sends concurrent HTTP requests from your computer through API Gateway → Lambda → DSQL. We use it to exercise concurrent inventory updates and stock exhaustion. Newman runs our Postman checks sequentially; ApacheBench supplies the concurrent load without a custom runner.

### Install ApacheBench

Check whether it is already installed:

```sh
ab -V
```

On macOS, `ab` may already be available at `/usr/sbin/ab`. If it is missing and you use Homebrew, the [httpd package](https://formulae.brew.sh/formula/httpd) includes it:

```sh
brew install httpd
```

If needed, invoke the installed binary as `"$(brew --prefix httpd)/bin/ab"` in place of `ab`. You do not need to start the Apache server.

On Ubuntu/Debian:

```sh
sudo apt-get update
sudo apt-get install apache2-utils
```

### Run the load test

Run from the demo directory so the JSON payload path resolves. Replace the URL with the deployed `ApiUrl`. Reset first to start with four buckets of 10 units each; see [Set bucket stock](#set-bucket-stock).

Read the starting stock, then run one approach at a time. Each command sends 60 requests with up to 5 concurrent requests through API Gateway.

**Check Lambda concurrency before testing.** In AWS Service Quotas, select the Region where you deployed and check **AWS Lambda → Concurrent executions**. Other functions share this regional capacity, and any reserved-concurrency limit on the tested function also applies. Choose an ApacheBench `-c` value below the capacity available to your test. Start with `-c 5`, or lower if needed.

If Lambda rejects invocations because of throttling, API Gateway can return HTTP 500 even though the request never reached your handler. Check the function's **Throttles** metric in CloudWatch before treating those responses as application or DSQL failures. Request a quota increase in the same Region if you need more capacity, and wait until it is applied before increasing `-c`.

**Two queries — SELECT, then UPDATE:**

```sh
curl https://YOUR_API.execute-api.YOUR_REGION.amazonaws.com/demo/stock/bucketed
ab -n 60 -c 5 -l -s 35 \
  -p api-collections/bucketed.json \
  -T application/json \
  https://YOUR_API.execute-api.YOUR_REGION.amazonaws.com/demo/decrement
curl https://YOUR_API.execute-api.YOUR_REGION.amazonaws.com/demo/stock/bucketed
```

Reset to 40 units using [Set bucket stock](#set-bucket-stock) before running the second approach.

**Single query — selection inside UPDATE:**

```sh
curl https://YOUR_API.execute-api.YOUR_REGION.amazonaws.com/demo/stock/bucketed
ab -n 60 -c 5 -l -s 35 \
  -p api-collections/bucketed.json \
  -T application/json \
  https://YOUR_API.execute-api.YOUR_REGION.amazonaws.com/demo/decrement-single-query
curl https://YOUR_API.execute-api.YOUR_REGION.amazonaws.com/demo/stock/bucketed
```

There are 40 units after setting each bucket to 10. This 60-request run exercises concurrent decrements and stock exhaustion; some responses should be 409 once inventory is empty, and conflicts can return 503. The full Postman collection sets the buckets to 10 and then consumes two units.

| Option | Meaning |
| --- | --- |
| `-n 60` | Send 60 requests in total |
| `-c 5` | Keep up to 5 requests in flight at a time |
| `-l` | Allow response lengths to vary as stock changes |
| `-s 35` | Wait up to 35 seconds for a response |
| `-p api-collections/bucketed.json` | POST the file's body: `{"product":"bucketed"}` |
| `-T application/json` | Set the request content type to JSON |
| URL | Send requests to the selected decrement endpoint |

### Read the results

| Report field | Meaning |
| --- | --- |
| Complete requests | Completed requests, including non-2xx responses |
| Failed requests | Transport/protocol failures; does not count every HTTP error |
| Non-2xx responses | HTTP responses outside 200–299, including 409 and 503 |
| Requests per second | Completed requests per second, including error responses |
| Time per request | Concurrency-adjusted mean; the second line is elapsed time divided by completed requests |
| Percentage served within | Request latency percentiles; inspect the 50% and 95% rows |

For this API, 200 means decremented, 409 means out of stock, 503 means transaction conflicts after retries, 429 means throttling and 500 means an application or integration error. Lambda invocation throttling can also surface as API Gateway 500 responses; inspect Lambda CloudWatch metrics to distinguish it from a database error. **Failed requests: 0 does not mean every decrement succeeded.**

Add `-v 3` to the same `ab` command to inspect response status codes. ApacheBench does not validate JSON bodies or automatically reconcile stock; use the stock GET before and after the run. Its summary groups non-2xx responses together.

With positive starting stock, no other callers and no transport failures, the stock decrease should match the number of HTTP 200 responses. Investigate throttling, unexpected errors or lost responses before drawing conclusions. Do not automatically resend failed writes: a lost response may hide a committed decrement.

To compare the two helpers, reset stock between runs and keep concurrency and request count equal. This tests the whole application through API Gateway, Lambda and DSQL; cold starts, networking and AWS limits affect the result. No performance advantage is claimed before testing against AWS.

## API

| Request | Response |
| --- | --- |
| `POST /stock/bucketed` with `{buckets:[{bucketId, remaining}]}` | 200: `{outcome:"stock_set", buckets:[{bucketId, remaining}]}`; 400: invalid input or duplicate IDs; 404: `{message:"Bucket not found"}`; 503: `{outcome:"conflict"}` |
| `GET /stock/bucketed` | 200: `{product, remaining, buckets:[{bucketId, remaining}]}` |
| `POST /decrement` or `/decrement-single-query` with `{"product":"bucketed"}` | 200: `{outcome:"decremented", bucketId, bucketRemaining}` |
| No positive bucket in the transaction snapshot | 409: `{outcome:"out_of_stock"}` |
| Transaction conflicts after connector retries | 503: `{outcome:"conflict"}` |
| Invalid/missing product or extra body fields | 400 from API Gateway |
| Unexpected Lambda error | 500: `{message:"Internal error"}` |

A conflict does not mean out of stock. Successful responses report the selected bucket's remaining stock, not the product total. Lambda responses include JSON content type and `Access-Control-Allow-Origin: *`; API Gateway errors may differ.

The decrement endpoints have no HTTP idempotency: a lost response may hide a committed decrement. Sending that request again can consume another unit.

## Set bucket stock

After deployment, readers can set stock through the API without AWS credentials or an IAM user. AWS credentials with deployment permissions are still required to deploy and delete the stack; stored access keys are not required if you use an AWS CLI sign-in method such as IAM Identity Center.

`POST /stock/bucketed` accepts a `buckets` array with 1–4 entries. Each entry sets the supplied bucket to its exact remaining value. Omitted buckets stay unchanged. Bucket IDs are 0–3 and must be distinct. Remaining stock must be an integer from 0 to 2,147,483,647; zero empties that bucket.

Stop all callers and wait for outstanding requests to finish before changing stock. For example:

```sh
curl --fail-with-body \
  --header 'Content-Type: application/json' \
  --data '{"buckets":[{"bucketId":1,"remaining":3},{"bucketId":2,"remaining":0},{"bucketId":3,"remaining":20}]}' \
  https://YOUR_API.execute-api.YOUR_REGION.amazonaws.com/demo/stock/bucketed
```

This sets bucket 1 to 3, bucket 2 to 0 and bucket 3 to 20, leaving bucket 0 unchanged. The Lambda loops through the entries inside one transaction: all requested updates commit together, or none do. The response lists the updated buckets, not the product's total stock. Duplicate IDs return 400 before any updates.

To prepare all four buckets at 10 (40 total) for a load test:

```sh
curl --fail-with-body \
  --header 'Content-Type: application/json' \
  --data '{"buckets":[{"bucketId":0,"remaining":10},{"bucketId":1,"remaining":10},{"bucketId":2,"remaining":10},{"bucketId":3,"remaining":10}]}' \
  https://YOUR_API.execute-api.YOUR_REGION.amazonaws.com/demo/stock/bucketed

curl https://YOUR_API.execute-api.YOUR_REGION.amazonaws.com/demo/stock/bucketed
```

Verify the total is 40 before testing. Do not set stock during a load test: replacing amounts invalidates the stock accounting. The demo API is unauthenticated, so anyone with its URL can change stock.

The deployment setup Lambda remains private and creates the schema, permissions and initial rows.

## Check infrastructure locally

```sh
node app.mjs
```

This synthesizes CloudFormation into `cdk.out` without deploying. Real API and concurrency testing requires an AWS deployment.

Dependencies are pinned. The CDK tooling has known bundled dependency audit findings (two moderate, one high at the last check); all five Lambda dependency audits were clean at their last check. Review upstream fixes before publishing.

## Delete the demo

When you finish testing, run this from the same directory using the profile and Region you deployed to:

```sh
npx cdk destroy DsqlInventoryDemo --profile YOUR_PROFILE --region YOUR_REGION
```

Review the confirmation prompt and enter `y` to delete the stack. This permanently deletes the demo database and its stock, API Gateway API, application Lambda functions, their IAM roles and managed application log groups.

The account-level `CDKToolkit` bootstrap stack, its asset bucket and uploaded deployment assets remain. The deployment trigger's provider log group can also remain. These are outside the demo stack's cleanup; review them separately, and do not delete bootstrap resources shared with other projects. Deleting the demo stops ongoing use of its resources, but does not reverse charges already incurred.

## Sources and credit

- Lycore's comment on [No Locks, Still Conflicts](https://medium.com/@anuranasinghe151/no-locks-still-conflicts-understanding-aurora-dsql-21c53f38b5df) prompted this example.
- Tejas Dubey, Edigar Chikwama and Rajesh Kantamani: [Building scalable applications on Aurora DSQL](https://aws.amazon.com/blogs/database/building-scalable-applications-on-amazon-aurora-dsql/).
- [DSQL concurrency](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-concurrency-control.html), [DDL transactions](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-ddl.html) and [database/IAM roles](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/using-database-and-iam-roles.html).

## License

[MIT](LICENSE) © 2026 Anuradha Ranasinghe. You may copy, modify and redistribute the demo under the license terms.
