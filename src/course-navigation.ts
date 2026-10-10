import type { CourseModule, Role } from './types';

export type CourseActivity = { type: 'lesson'; id: string } | { type: 'quiz'; id: string };

export function shouldEnrollBeforeCourseActivity(role: Role | null | undefined): boolean {
  return role === 'learner';
}

export function nextCourseActivityAfterLesson(modules: CourseModule[] | undefined, lessonId: string): CourseActivity | null {
  let foundCurrentLesson = false;
  for (const module of modules ?? []) {
    for (const lesson of module.lessons) {
      if (foundCurrentLesson) return { type: 'lesson', id: lesson.id };
      if (lesson.id === lessonId) foundCurrentLesson = true;
    }
    if (foundCurrentLesson && module.quiz && !module.quiz.passed) return { type: 'quiz', id: module.quiz.id };
  }
  return null;
}

export function nextCourseActivity(modules: CourseModule[] | undefined): CourseActivity | null {
  const orderedModules = modules ?? [];
  for (const module of orderedModules) {
    const lesson = module.lessons.find((item) => !item.completed);
    if (lesson) return { type: 'lesson', id: lesson.id };
    if (module.quiz && !module.quiz.passed) return { type: 'quiz', id: module.quiz.id };
  }

  const firstLesson = orderedModules.flatMap((module) => module.lessons)[0];
  return firstLesson ? { type: 'lesson', id: firstLesson.id } : null;
}
