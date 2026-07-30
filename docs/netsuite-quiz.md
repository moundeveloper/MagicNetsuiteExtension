# NetSuite Quiz

The NetSuite Quiz view turns an AI-generated, documentation-backed question bank
into either assisted practice or a timed exam.

## Creation workflow

1. Submit independent NetSuite documentation topics with
   `netsuite_submit_docs_batch`.
2. Poll the job with `netsuite_get_docs_batch` until it completes.
3. Distill the returned documentation into 10–60 questions.
4. Persist the question bank with `magic_netsuite_create_quiz`, passing the
   completed batch job ID as `sourceBatchJobId`.
5. Inspect saved banks with `magic_netsuite_list_quizzes` and
   `magic_netsuite_get_quiz`.
6. Delete an unwanted bank with `magic_netsuite_delete_quiz` after listing
   banks and confirming its exact ID.

Quiz creation validates every supplied citation against the source batch. A
citation must point to an official NetSuite Help Center page that the batch read,
and its `quote` must occur in the extracted page text. Every question without a
code block must include at least one citation that directly supports the complete
answer. Broad architecture, security, reliability, performance, and
best-practice claims cannot be inferred merely because a related page was
searched. Questions whose answers follow entirely from reasoning about a
supplied code block may omit evidence. This exception does not apply when the
answer depends on NetSuite platform behavior that is not visible in the snippet.
Citation quotes are stored as literal page text. Markdown backticks, emphasis,
link syntax, and similar presentation markers are removed before validation so
the saved quote matches the text in the live `#nshelp` article.

## Question shape

Each question supports:

- `single` or `multiple` correct-answer modes
- two or more answer options
- an explanation shown after grading
- optional documentation citations with an exact supporting quote
- an optional language-tagged code block

Example code block:

```json
{
  "code": {
    "language": "javascript",
    "caption": "SuiteScript 2.1",
    "content": "define(['N/record'], (record) => { /* ... */ });"
  }
}
```

Code blocks can contain SuiteScript, SuiteQL, FreeMarker, JSON, XML, or another
language. They are displayed above the answer options in a scrollable monospace
panel.

A code block must not give away its own answer. It must not contain the correct
option verbatim or visibly include the exact API, property, method, module, or
path the learner is being asked to identify. For a missing-expression question,
the tested expression must be replaced with a neutral placeholder such as
`/* choose the correct expression */`. Quiz creation and import reject obvious
identifier/path leaks, including simple variable aliases.

Code blocks also must not turn questions into transcription exercises. Do not
ask which entry points, exports, methods, fields, properties, or operations are
present when the snippet visibly lists the answer. Require behavioral tracing,
diagnosis, output prediction, or a justified correction instead.

Conversely, a question must not omit the artifact it asks the learner to
analyze. If the prompt refers to or structurally describes a particular query,
code fragment, XML fragment, expression, or configuration, the corresponding
language-tagged `code` block is required. Quiz creation and import reject these
prose-only code-analysis questions.

## Session modes

- **Assisted practice** grades each question immediately, reveals the correct
  answer and explanation, and links to highlighted documentation evidence when
  the question has directly supporting citations.
- **Exam simulation** withholds feedback until submission. It allocates 90
  seconds per question, so a 60-question exam lasts 90 minutes.

The selected number of questions is randomized from the saved bank. The launch
control permits 10–60 questions and never exceeds the number available.

When more than one bank exists, **All banks shuffled** combines every bank into
one question pool. Question IDs are namespaced by their source bank before the
session is randomized, preventing collisions between independently generated
banks.

## Import and export

The question-bank toolbar imports and exports portable JSON packages:

- Exporting a selected bank downloads that bank.
- Exporting **All banks shuffled** packages every underlying bank, not the
  temporary combined session.
- Import accepts a versioned Magic NetSuite package, an array of quizzes, or one
  quiz object.
- Imported questions are revalidated, including answer rules, explanations,
  optional official-documentation citations, and optional code blocks.
- Matching quiz IDs or titles are replaced; other quizzes are added.

The package format is identified by `format: "magic-netsuite-quizzes"` and
`version: 1`.

Citation links carry a private fragment marker understood by the extension's
embedded documentation reader. The real NetSuite page remains loaded with its
original styles; the reader hides page chrome outside the existing `#nshelp`
element, highlights the cited range even when it crosses nested text nodes, and
scrolls that range into view. The panel also provides an external-tab action for
pages that prevent embedding.
