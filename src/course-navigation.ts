import type { CourseModule, Quiz, Role } from './types';

export type CourseActivity = { type: 'lesson'; id: string } | { type: 'quiz'; id: string } | { type: 'exam'; id: string };

export function shouldEnrollBeforeCourseActivity(role: Role | null | undefined): boolean {
  return role === 'learner';
}

export function completedCourseActionLabel(completed: boolean): string | null {
  return completed ? 'Review course' : null;
}

export function courseCardActionLabel({ completed, progress }: { completed: boolean; progress: number }): string {
  // Completion is authoritative; displayed progress may round to 100 before every activity is done.
  const reviewLabel = completedCourseActionLabel(completed);
  if (reviewLabel) return reviewLabel;
  return progress > 0 ? 'Continue course' : 'Start course';
}

export function courseActivityActionLabel({ starting, completed, nextActivity, progress }: {
  starting: boolean;
  completed: boolean;
  nextActivity: CourseActivity | null;
  progress: number;
}): string {
  if (starting) return 'Starting…';
  // Completed courses remain reviewable; navigation intentionally starts at the first lesson.
  const reviewLabel = completedCourseActionLabel(completed);
  if (reviewLabel) return reviewLabel;
  if (nextActivity?.type === 'quiz') return progress > 0 ? 'Continue to quiz' : 'Start quiz';
  if (nextActivity?.type === 'exam') return progress > 0 ? 'Continue to final exam' : 'Start final exam';
  return progress > 0 ? 'Continue learning' : 'Start learning';
}

export function nextCourseActivityAfterLesson(modules: CourseModule[] | undefined, lessonId: string, finalExam?: Quiz | null): CourseActivity | null {
  let foundCurrentLesson = false;
  for (const module of modules ?? []) {
    for (const lesson of module.lessons) {
      if (foundCurrentLesson) return { type: 'lesson', id: lesson.id };
      if (lesson.id === lessonId) foundCurrentLesson = true;
    }
    if (foundCurrentLesson && module.quiz && !module.quiz.passed) return { type: 'quiz', id: module.quiz.id };
  }
  if (foundCurrentLesson && finalExam && !finalExam.passed) return { type: 'exam', id: finalExam.id };
  return null;
}

export function nextCourseActivity(modules: CourseModule[] | undefined, finalExam?: Quiz | null): CourseActivity | null {
  const orderedModules = modules ?? [];
  for (const module of orderedModules) {
    const lesson = module.lessons.find((item) => !item.completed);
    if (lesson) return { type: 'lesson', id: lesson.id };
    if (module.quiz && !module.quiz.passed) return { type: 'quiz', id: module.quiz.id };
  }

  if (finalExam && !finalExam.passed) return { type: 'exam', id: finalExam.id };

  const firstLesson = orderedModules.flatMap((module) => module.lessons)[0];
  return firstLesson ? { type: 'lesson', id: firstLesson.id } : null;
}
