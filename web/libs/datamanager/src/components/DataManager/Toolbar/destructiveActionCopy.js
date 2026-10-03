const objectTypeKeys = {
  delete_tasks: "destructiveObjectTasks",
  delete_annotations: "destructiveObjectAnnotations",
  delete_tasks_annotations: "destructiveObjectAnnotations",
  delete_predictions: "destructiveObjectPredictions",
  delete_tasks_predictions: "destructiveObjectPredictions",
  delete_reviews: "destructiveObjectReviews",
  delete_tasks_reviews: "destructiveObjectReviews",
  delete_reviewers: "destructiveObjectReviewAssignments",
  delete_annotators: "destructiveObjectAnnotatorAssignments",
  delete_ground_truths: "destructiveObjectGroundTruths",
};

export const destructiveActionCopy = (actionId, t) => {
  const object = t(objectTypeKeys[actionId] ?? "destructiveObjectItems");

  return {
    title: t("deleteSelectedObject", { object }),
    text: t("deleteSelectedObjectConfirm", { object }),
    okText: t("delete"),
  };
};
