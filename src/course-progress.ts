import type { CourseModule, Quiz } from './types';

export function summarizeCourseProgress(modules: CourseModule[], finalExam?: Quiz | null) {
  let lessonCount = 0;
  let completedLessons = 0;
  let quizCount = 0;
  let passedQuizzes = 0;

  for (const module of modules) {
    lessonCount += module.lessons.length;
    completedLessons += module.lessons.filter((lesson) => lesson.completed).length;
    if (module.quiz) {
      quizCount += 1;
      if (module.quiz.passed) passedQuizzes += 1;
    }
  }

  const totalActivities = lessonCount + quizCount;
  const finalExamRequired = Boolean(finalExam?.requiredForCompletion);
  const finalExamPassed = Boolean(finalExam?.passed);
  const requiredActivities = totalActivities + Number(finalExamRequired);
  const completedActivities = completedLessons + passedQuizzes + Number(finalExamRequired && finalExamPassed);
  return {
    completedLessons,
    progress: requiredActivities > 0 ? Math.round((completedActivities / requiredActivities) * 100) : 0,
    completed: requiredActivities > 0 && completedActivities === requiredActivities,
  };
}
