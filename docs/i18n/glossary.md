# V1 terminology and translation rules

These display terms are shared by Django gettext and the frontend catalogs.
They do not rename API values, database fields, route names, event names,
hotkey actions or persisted user content. Context matters: a working
annotation is not an immutable submission, and approval is not release.

| Domain concept | English UI | 简体中文 UI | Machine / behavior boundary |
| --- | --- | --- | --- |
| Annotation | Annotation / working annotation | 标注 / 工作标注 | Mutable work, possibly a draft; preserve `annotation`, `annotation_id` and result payload. |
| Draft | Draft / Save draft | 草稿 / 保存草稿 | Saving a draft does not create a formal submission. Do not turn Save into Submit. |
| Submission | Submission / submitted revision | 正式提交版本 / 已提交版本 | Immutable `Submission` with a specific revision, `result_snapshot` and `result_hash`. |
| Review | Review / Review decision | 审核 / 审核决定 | Reviewer approves or rejects a particular Submission; preserve `pending`, `approved`, `rejected`, `superseded`, and decision values. |
| Release | Release approved revision | 发布已批准版本 | Manager publishes the selected approved revision; preserve its ID/hash/snapshot. Approval alone is not release. |
| Assignment | Task assignment / Assign / Cancel assignment | 任务分配 / 分配 / 取消分配 | Explicit assignee and assignment ID/version; a task lock does not grant assignment authorization. |
| Manager | Manager | 项目管理员 | Display label only; keep `manager` role value. |
| Annotator | Annotator | 标注员 | Display label only; keep `annotator` role value. |
| Reviewer | Reviewer | 审核员 | Display label only; keep `reviewer` role value. |
| Save | Save | 保存 | Means current form/work save, subject to the specific screen; not submission or release. |
| Submit | Submit | 正式提交 | Explicit operation that creates a Submission under existing authorization. |
| Approve / Reject | Approve / Reject | 批准 / 拒绝 | Review decision for the exact immutable revision. |
| Skip | Skip task | 跳过任务 | Keep existing skip action and hotkey identifiers. |
| Auto language | Automatic | 自动 | No saved explicit preference (`null`); resolve per request. |

Use full terms where an action could be confused: `正式提交` for the editor's
submission action, `发布已批准版本` for release, and `保存草稿` for a draft save.
`审核通过` is a review result, not a publication confirmation. Keep the
revision number and result hash visible and unchanged in review/release UI.
Pluralization follows each language's grammar; an English plural suffix need
not have a matching Chinese suffix. Insert user names, project titles, task
text, labels, rejection reasons and filenames as escaped data, never as
translation keys or HTML. Do not translate sample annotation values or
`label_config` definitions to simulate a localized product.
