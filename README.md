# Aurora DSQL inventory buckets

A small JavaScript CDK demo using API Gateway, Lambda and Aurora DSQL.

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

Reset stock between comparisons and keep all other settings equal. The single-statement helper has not yet been executed against DSQL. Verify its query plan, stock accounting and concurrent behaviour before making performance claims.

For the article, show the two-step approach first, explain why always selecting the first bucket creates contention, then introduce the combined statement. Compare application readability, network round trips and database work. Close with: **Which approach would you choose for this case, and why?**

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

The API is public and has no application authentication. Database access uses IAM: the stock reader has SQL `SELECT` permission, the writer has `SELECT, UPDATE`, and the private setup function uses the database admin role. Run this in a disposable test environment. AWS resources incur charges.

## Test with Postman from the CLI

Install Newman once:

```sh
npm install -g newman@6.2.2
```

Use the deployed `ApiUrl` without a trailing slash:

```sh
npm run api-test -- --env-var baseUrl=https://YOUR_API.execute-api.YOUR_REGION.amazonaws.com/demo
```

The collection has a folder for each approach. Each reads stock, decrements one unit, verifies the total and checks invalid requests are rejected without changing stock. Running both requires at least two units and consumes two units total. Saved error examples are illustrative; the collection does not force database errors.

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

Run from the demo directory so the JSON payload path resolves. Replace the URL with the deployed `ApiUrl`. Reset first to start with four buckets of 10 units each; see [Reset stock](#reset-stock).

Read the starting stock, then run one approach at a time. Each command sends 60 requests with up to 5 concurrent requests through API Gateway. Concurrency 5 fits the current test account's Lambda quota of 10; check your regional quota before increasing it.

**Two queries — SELECT, then UPDATE:**

```sh
curl https://YOUR_API.execute-api.YOUR_REGION.amazonaws.com/demo/stock/bucketed
ab -n 60 -c 5 -l -s 35 \
  -p api-collections/bucketed.json \
  -T application/json \
  https://YOUR_API.execute-api.YOUR_REGION.amazonaws.com/demo/decrement
curl https://YOUR_API.execute-api.YOUR_REGION.amazonaws.com/demo/stock/bucketed
```

Reset to 40 units using [Reset stock](#reset-stock) before running the second approach.

**Single query — selection inside UPDATE:**

```sh
curl https://YOUR_API.execute-api.YOUR_REGION.amazonaws.com/demo/stock/bucketed
ab -n 60 -c 5 -l -s 35 \
  -p api-collections/bucketed.json \
  -T application/json \
  https://YOUR_API.execute-api.YOUR_REGION.amazonaws.com/demo/decrement-single-query
curl https://YOUR_API.execute-api.YOUR_REGION.amazonaws.com/demo/stock/bucketed
```

There are only 40 units after a reset. This 60-request run exercises concurrent decrements and stock exhaustion; some responses should be 409 once inventory is empty, and conflicts can return 503. The full Postman collection consumes two units if run beforehand.

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

For this API, 200 means decremented, 409 means out of stock, 503 means transaction conflicts after retries, 429 means throttling and 500 means an unexpected error. **Failed requests: 0 does not mean every decrement succeeded.**

Add `-v 3` to the same `ab` command to inspect response status codes. ApacheBench does not validate JSON bodies or automatically reconcile stock; use the stock GET before and after the run. Its summary groups non-2xx responses together.

With positive starting stock, no other callers and no transport failures, the stock decrease should match the number of HTTP 200 responses. Investigate throttling, unexpected errors or lost responses before drawing conclusions. Do not automatically resend failed writes: a lost response may hide a committed decrement.

To compare the two helpers, reset stock between runs and keep concurrency and request count equal. This tests the whole application through API Gateway, Lambda and DSQL; cold starts, networking and AWS limits affect the result. No performance advantage is claimed before testing against AWS.

## API

| Request | Response |
| --- | --- |
| `GET /stock/bucketed` | 200: `{product, remaining, buckets:[{bucketId, remaining}]}` |
| `POST /decrement` or `/decrement-single-query` with `{"product":"bucketed"}` | 200: `{outcome:"decremented", bucketId, bucketRemaining}` |
| No positive bucket in the transaction snapshot | 409: `{outcome:"out_of_stock"}` |
| Transaction conflicts after connector retries | 503: `{outcome:"conflict"}` |
| Invalid/missing product or extra body fields | 400 from API Gateway |
| Unexpected Lambda error | 500: `{message:"Internal error"}` |

A conflict does not mean out of stock. Successful responses report the selected bucket's remaining stock, not the product total. Lambda responses include JSON content type and `Access-Control-Allow-Origin: *`; API Gateway errors may differ.

There is no HTTP idempotency: a lost response may hide a committed decrement. Sending that request again can consume another unit.

## Reset stock

Stop all callers and wait for outstanding requests to finish. Use the deployed `SetupFunction` output:

```sh
aws lambda invoke --function-name YOUR_SETUP_FUNCTION --payload '{"action":"reset"}' --cli-binary-format raw-in-base64-out --profile YOUR_PROFILE --region YOUR_REGION /tmp/dsql-inventory-reset.json
```

Redeploy after changing the seed/reset values, then invoke reset to update an existing database; seeding preserves rows already present. Check that the invocation has no `FunctionError`. This restores the four inventory buckets to 10 units each (40 total).

## Check infrastructure locally

```sh
node app.mjs
```

This synthesizes CloudFormation into `cdk.out` without deploying. Real API and concurrency testing requires an AWS deployment.

Dependencies are pinned. The CDK tooling has known bundled dependency audit findings (two moderate, one high at the last check); the original three Lambda dependency audits were clean. Review upstream fixes before publishing.

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
