# Non-blocking NetSuite documentation research

The MCP server exposes a shared, persistent FIFO worker for researching several
official NetSuite Help Center topics without making an agent wait on the
authenticated browser tab.

Use this workflow when:

- two or more agents need NetSuite documentation at the same time;
- one task needs several independent documentation topics;
- the agent should continue useful work while documentation is fetched.

For one quick lookup, `netsuite_search_docs` and `netsuite_read_doc_page` remain
available as synchronous tools.

## Submit work

Call `netsuite_submit_docs_batch`:

```json
{
  "queries": [
    "Map/Reduce governance and yielding",
    "saved search formula limitations",
    "SuiteTax transaction nexus behavior"
  ],
  "pagesPerQuery": 1,
  "maxSearchResults": 5
}
```

The call validates and de-duplicates the topics, stores the batch, queues it,
and immediately returns a `jobId`. It does not wait for a Help Center request.
Each agent should retain its own `jobId`; agents can submit separate jobs
without coordinating access to the browser tab.

The worker processes jobs in submission order and processes topics one at a
time. This bounds load on the authenticated NetSuite session while leaving the
MCP/native bridge available for other tool calls. Batch state is stored in
`chrome.storage.local`, so an interrupted extension service worker can resume
queued or partially completed work on the next batch submit/status call.

`pagesPerQuery` defaults to `1` and may be `0` through `3`. Use `0` when search
titles, URLs, and summaries are enough. A batch accepts up to 20 unique topics.

## Check progress and receive results

Call `netsuite_get_docs_batch` with the returned ID:

```json
{
  "jobId": "the-returned-job-id",
  "includeContent": false
}
```

This status call is also non-blocking. While `status` is `queued` or `running`,
the agent should continue other work and check again later. Terminal statuses
are:

- `completed`: every topic and requested page read succeeded;
- `completed_with_errors`: usable results exist, but at least one topic or page
  read had an error;
- `failed`: every topic failed.

To collect full page text for only the topics owned by an agent:

```json
{
  "jobId": "the-returned-job-id",
  "topicIndexes": [0, 2],
  "includeContent": true
}
```

Topic indexes are zero-based and are returned by the submit call. Each topic
keeps its search results, successfully read pages, and page-level errors
independently, so one bad Help Center page does not discard the rest of the
batch.

Answers based on returned page content must cite the corresponding NetSuite
Help Center URLs.
