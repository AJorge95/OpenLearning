# Quality Improvement Tracker

## 2026-10-09 — Return useful errors for invalid or oversized request bodies

- **Reviewed:** Existing uncommitted setup, authentication, branding, settings, and style changes; Express middleware and error handling; application forms and responsive/accessibility styles.
- **Improvement:** Map Express JSON and URL-encoded parser failures to client errors: malformed JSON returns `400 invalid_json`, and bodies over the configured limit return `413 payload_too_large`.
- **Why it helps:** Clients receive an actionable response for malformed or oversized input, and expected request errors no longer appear as internal server failures.
- **Checked:** `node --check server/http.js`; `npm run build`; direct checks of both Express parser error mappings (`entity.parse.failed` and `entity.too.large`).

## 2026-10-09 — Restore visible focus feedback for search controls

- **Reviewed:** Current lesson-resource editor changes, search-control markup, shared input styles, and responsive layout rules.
- **Improvement:** Add a palette-aware focus ring to the catalog, management, and course-access search containers whose inputs suppress their own outline.
- **Why it helps:** Keyboard users can see which search field is active, across both the default and alternate color palettes.
- **Checked:** `npm run build`.

## 2026-10-09 — Lesson-resource follow-up review

- **Reviewed:** Lesson resource payloads, staff-only link and document creation/removal, file type and size checks, authenticated downloads, and learner-facing resource links.
- **Result:** No additional code change; this focused source review did not establish another isolated defect.
- **Checked:** Isolated API integration with a temporary database and session store: document upload returned 201; a granted learner downloaded the expected bytes (200); an ungranted learner was denied (403); anonymous access was denied (401). Temporary files were removed.

## 2026-10-09 — Connect lesson disclosure buttons to their panels

- **Reviewed:** Lesson editor disclosure controls, expanded state, panel rendering, and accessible names.
- **Improvement:** Add `aria-controls` relationships from both lesson-details buttons to the panel while expanded.
- **Why it helps:** Assistive technology can associate each control with the details region it opens, and both controls announce the same expanded state.
- **Checked:** `npx tsc --noEmit`; `npm run build`.

## 2026-10-09 — Batch lesson resource and completion lookups

- **Reviewed:** Course payload construction and the lesson-resource/progress queries used by learner and management views.
- **Improvement:** Load all resources and completed lesson IDs for the course in two queries, then map them to lessons in memory instead of issuing those lookups once per lesson.
- **Why it helps:** Payload query work no longer grows by two SQLite round trips for each additional lesson, while preserving resource ordering and per-user completion state.
- **Checked:** Isolated database fixture for ordered link/document mapping and learner/anonymous completion state; `node --check`; `npx tsc --noEmit`; `npm run build`; `git diff --check`.

## 2026-10-09 — Show focus on file upload controls

- **Reviewed:** Course cover, video, lesson document, and platform icon upload inputs and their shared visually-hidden input styling.
- **Improvement:** Give the styled upload labels a solid palette-aware focus ring while their transparent file inputs receive keyboard focus.
- **Why it helps:** Keyboard users can see which upload control is active, including when the native file input itself is visually hidden.
- **Checked:** `npm run build`; `git diff --check`.

## 2026-10-09 — Rendered keyboard-focus validation

- **Reviewed:** The running local admin UI, course catalog search, and course-cover file picker under the forest palette.
- **Result:** No additional code change; keyboard navigation showed a solid 2px forest outline around both focused controls.
- **Checked:** On `http://127.0.0.1:5173`, Tab from the search input moved to Submit search while the search container remained outlined. Tab from the course description field focused the visually hidden cover input and outlined its visible label. Screenshots confirmed both states; no file was selected and no form was saved.
- **Limitations:** This browser interface exposes DOM, screenshots, and Playwright locators but no console-log or viewport-override API, so console diagnostics and mobile-sized rendering remain unverified.

## 2026-10-09 — Keep keyboard focus inside the password-reset dialog

- **Reviewed:** Administrator user-management actions, the password-reset dialog semantics, and the current focus behavior.
- **Improvement:** Trap Tab and Shift+Tab within the dialog, close it with Escape, restore focus to the button that opened it, and associate its explanatory text with the dialog.
- **Why it helps:** Keyboard and assistive-technology users can complete or leave the modal without losing their place in the users table.
- **Checked:** `npx tsc --noEmit`; `npm run build`; `git diff --check`; local browser interaction confirmed initial focus in New password, forward and reverse focus wrapping, Escape closing the dialog, and focus returning to the invoking Reset password button. No password was entered or submitted.

## 2026-10-09 — Registration-cap reliability review

- **Reviewed:** Public registration checks, account-limit configuration validation, and the project's documented single-process deployment model.
- **Result:** No additional code change; registration rechecks the enabled state and user count inside a synchronous SQLite transaction immediately before inserting the account, and the settings route validates the configured cap.
- **Why no change:** The current source does not establish a defect for the documented deployment model. Multi-process registration guarantees would need an explicit deployment requirement and dedicated concurrency design.
- **Checked:** Read the registration and settings routes, SQLite transaction usage, and the README deployment requirements.

## 2026-10-09 — Treat search punctuation literally

- **Reviewed:** Search pattern construction in the learner catalog, course-management list, administrator user list, and private-course access list.
- **Improvement:** Escape SQLite `LIKE` wildcard characters (`%` and `_`) plus the chosen `!` escape character, so all these searches treat user input as literal text.
- **Why it helps:** Punctuation in a username, title, description, or category no longer broadens a search into unrelated results.
- **Checked:** In-memory SQLite matching for literal `%`, `_`, `!`, backslash, and ordinary substrings; private-course learner-search SQL for wildcard punctuation and empty search; `node --check` on the helper and affected routes; `npx tsc --noEmit`; `npm run build`; `git diff --check`.

## 2026-10-09 — Validate admin account-status values

- **Reviewed:** The administrator endpoint that changes a user's role and disabled state, and the JSON values sent by the UI.
- **Improvement:** Require `disabled` to be a JSON boolean when supplied instead of coercing strings, numbers, or null to truthy/falsy values.
- **Why it helps:** Malformed clients can no longer accidentally disable an account by sending a value such as the string `"false"`.
- **Checked:** Isolated Express route with a temporary SQLite database: string, numeric, and null values returned 400 without mutation; boolean `true` and `false` returned 200 and updated state correctly. `node --check`; `git diff --check`. Temporary database was removed.

## 2026-10-09 — Give learners a recovery path for video load failures

- **Reviewed:** The learner video element, its error events, lesson navigation, and narrow-screen player layout.
- **Improvement:** Announce a video-load error with a retry button, reload the current source on retry, clear the error when switching lessons, and stack the message and action on narrow screens.
- **Why it helps:** Learners get an understandable next step when media cannot load instead of relying on the browser's generic player error state.
- **Checked:** `npx tsc --noEmit`; `npm run build`; `git diff --check`; confirmed no media record or course content was changed.

## 2026-10-09 — Batch course-list summaries

- **Reviewed:** Summary construction for catalog, My Learning, and course-management lists, including lesson counts, completion, and quiz passes.
- **Improvement:** Add a batch summary path that fetches course counts, learner lesson progress, and passed-quiz counts in up to three queries for the whole list, then map results in memory.
- **Why it helps:** List response query work stays constant as the number of courses grows instead of running up to three SQLite queries per course.
- **Checked:** Temporary SQLite fixture confirmed counts, learner lesson and quiz progress, completion percentages, empty-course behavior, and unchanged single-course summaries; `node --check`; `git diff --check`.

## 2026-10-09 — Announce quiz results to assistive technology

- **Reviewed:** The learner quiz submission flow and the score panel that replaces the form after an attempt.
- **Improvement:** Give the dynamically rendered score panel the `status` role so assistive technology announces the pass/fail result and score.
- **Why it helps:** Learners who submit without seeing the page update can hear the outcome when it appears.
- **Checked:** `npx tsc --noEmit`; `npm run build`; `git diff --check`.

## 2026-10-09 — Batch quiz answer-choice lookups

- **Reviewed:** Choice loading in learner course payloads, staff quiz editing payloads, and quiz-attempt grading.
- **Improvement:** Load all choices for a course or submitted quiz in one ordered query and map them to questions in memory.
- **Why it helps:** Large quizzes avoid a separate SQLite query for every question during both display and grading, while preserving learner answer hiding and staff answer visibility.
- **Checked:** Temporary SQLite/Express fixture confirmed choice ordering, learner/staff answer visibility, invalid-answer rejection without an attempt, score, pass state, and saved snapshot; `node --check`; `git diff --check`.

## 2026-10-09 — Return the right status for malformed uploads

- **Reviewed:** Multer's configured one-file upload routes and the shared API error handler.
- **Improvement:** Return 400 for malformed upload fields/counts and 413 for oversized files or field values.
- **Why it helps:** Clients can distinguish incorrect multipart input from content that exceeds the server's accepted limits.
- **Checked:** Actual Multer error objects mapped unexpected file/count errors to 400 and file/field-size errors to 413; malformed JSON remained 400 and oversized JSON remained 413; `node --check`; `git diff --check`.

## 2026-10-09 — Protect saved quizzes from malformed payloads

- **Reviewed:** The quiz editor's update request and the server transaction that replaces stored questions and choices.
- **Improvement:** Require question and choice arrays and reject non-boolean `isCorrect` values before the transaction; keep omitted flags false and explicit empty question arrays valid.
- **Why it helps:** Malformed input can no longer be silently interpreted as deleting existing questions or marking the string `"false"` as correct.
- **Checked:** Isolated Express/SQLite route: missing, null, and malformed question/choice data returned 400 while preserving the saved question; explicit empty arrays still saved; omitted `isCorrect` remained false. `node --check`; `git diff --check`. Temporary DB was removed.

## 2026-10-09 — Recheck learner access and media delivery

- **Reviewed:** Course publication and visibility gates, learner grants, protected document access, and video path, lesson-link, `HEAD`, and byte-range handling.
- **Result:** No additional code change; the current route paths apply the expected viewer checks and file/stream constraints, and this review did not establish a reproducible access or delivery defect.
- **Why no change:** A useful next improvement depends on a concrete failing access/stream case or a clarified access policy; changing these guards without that evidence could alter intended course visibility.
- **Checked:** Read the course-viewer authorization helper and protected document/video routes; `git diff --check` passes. Existing working-tree changes were preserved.

## 2026-10-09 — Reject malformed API and upload responses cleanly

- **Reviewed:** Shared JSON response handling and the XHR-based media upload promise.
- **Improvement:** Parse JSON responses through a shared guarded helper, map malformed JSON to a typed `invalid_response` API error, and make upload setup a normal async function so synchronous setup failures reject the returned promise.
- **Why it helps:** A malformed JSON response no longer throws outside the upload promise and leaves its editor in a permanent busy state; regular API calls also receive a consistent actionable error.
- **Checked:** TypeScript and production build; isolated transport harness confirmed valid uploads resolve, malformed upload and API JSON reject with `ApiError`, and server upload status/code are preserved.
