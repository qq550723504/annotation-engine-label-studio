// Only platform-owned task columns are translated. Project data keys, labels,
// aliases, and user-defined titles remain exactly as supplied by the project.
const TASK_COLUMNS = {
  id: ["columnId", "columnIdHelp"],
  inner_id: ["columnInnerId", "columnInnerIdHelp"],
  completed_at: ["columnCompleted", "columnCompletedHelp"],
  total_annotations: ["columnAnnotations", "columnAnnotationsHelp"],
  cancelled_annotations: ["columnCancelled", "columnCancelledHelp"],
  total_predictions: ["columnPredictions", "columnPredictionsHelp"],
  annotators: ["columnAnnotators", "columnAnnotatorsHelp"],
  annotations_results: ["columnAnnotationResults", "columnAnnotationResultsHelp"],
  annotations_ids: ["columnAnnotationIds", "columnAnnotationIdsHelp"],
  predictions_score: ["columnPredictionScore", "columnPredictionScoreHelp"],
  predictions_model_versions: ["columnModelVersions", "columnModelVersionsHelp"],
  predictions_results: ["columnPredictionResults", "columnPredictionResultsHelp"],
  file_upload: ["columnUploadFilename", "columnUploadFilenameHelp"],
  storage_filename: ["columnStorageFilename", "columnStorageFilenameHelp"],
  created_at: ["columnCreatedAt", "columnCreatedAtHelp"],
  updated_at: ["columnUpdatedAt", "columnUpdatedAtHelp"],
  updated_by: ["columnUpdatedBy", "columnUpdatedByHelp"],
  avg_lead_time: ["columnLeadTime", "columnLeadTimeHelp"],
  draft_exists: ["columnDrafts", "columnDraftsHelp"],
};

export function displayColumnTitle(column, t) {
  const key = column?.target === "tasks" && !column?.parent && TASK_COLUMNS[column?.alias]?.[0];
  return key ? t(key) : column?.title;
}

export function displayColumnHelp(column, t) {
  const key = column?.target === "tasks" && !column?.parent && TASK_COLUMNS[column?.alias]?.[1];
  return key ? t(key) : column?.help;
}
