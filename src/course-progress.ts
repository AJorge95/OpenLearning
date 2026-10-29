import type { CourseModule, Quiz } from './types';

export function summarizeCourseProgress(modules: CourseModule[], finalExam?: Quiz | null) {
  let lessonCount = 0;
  let completedLessons = 0;
  let requiredQuizCount = 0;
  let passedRequiredQuizzes = 0;

  for (const module of modules) {
    lessonCount += module.lessons.length;
    completedLessons += module.lessons.filter((lesson) => lesson.completed).length;
    // Older course payloads omit this flag; keep their required-by-default behavior.
    if (module.quiz && module.quiz.requiredForCompletion !== false) {
      requiredQuizCount += 1;
      if (module.quiz.passed) passedRequiredQuizzes += 1;
    }
  }

  const totalActivities = lessonCount + requiredQuizCount;
  const finalExamRequired = Boolean(finalExam?.requiredForCompletion);
  const finalExamPassed = Boolean(finalExam?.passed);
  const requiredActivities = totalActivities + Number(finalExamRequired);
  const completedActivities = completedLessons + passedRequiredQuizzes + Number(finalExamRequired && finalExamPassed);
  return {
    completedLessons,
    progress: requiredActivities > 0 ? Math.round((completedActivities / requiredActivities) * 100) : 0,
    completed: requiredActivities > 0 && completedActivities === requiredActivities,
  };
}
