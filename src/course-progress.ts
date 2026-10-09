import type { CourseModule } from './types';

export function summarizeCourseProgress(modules: CourseModule[]) {
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
  const completedActivities = completedLessons + passedQuizzes;
  return {
    completedLessons,
    progress: totalActivities > 0 ? Math.round((completedActivities / totalActivities) * 100) : 0,
    completed: totalActivities > 0 && completedActivities === totalActivities,
  };
}
