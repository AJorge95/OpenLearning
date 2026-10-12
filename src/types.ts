export type Role = 'admin' | 'moderator' | 'learner';
export type RegistrationStatus = 'pending' | 'approved';

export type RegistrationFieldType = 'date' | 'text' | 'select' | 'checkbox';

export interface RegistrationField {
  id: string;
  label: string;
  type: RegistrationFieldType;
  required: boolean;
  options: string[];
}

export type RegistrationFieldValues = Record<string, string | boolean>;

export interface SavedRegistrationFieldValue {
  id: string;
  label: string;
  type: RegistrationFieldType;
  value: string | boolean;
}

export interface User {
  id: string;
  username: string;
  email?: string | null;
  firstName?: string;
  lastName?: string;
  role: Role;
  disabled: boolean;
  registrationStatus?: RegistrationStatus;
  isLastActiveAdmin?: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface QuizChoice {
  id?: string;
  text: string;
  isCorrect?: boolean;
}

export interface QuizQuestion {
  id?: string;
  prompt: string;
  explanation?: string;
  choices: QuizChoice[];
}

export interface QuizAttempt {
  id: string;
  score: number;
  correctCount: number;
  questionCount: number;
  passed: boolean;
  submittedAt?: string;
}

export interface QuizAttemptPreview {
  id: string;
  score: number;
  passed: boolean;
  submittedAt?: string;
}

export interface Quiz {
  id: string;
  title: string;
  passMark: number;
  questions: QuizQuestion[];
  latestAttempt: QuizAttemptPreview | null;
  passed: boolean;
}

export interface LessonResource {
  id: string;
  kind: 'link' | 'document';
  title: string;
  url: string;
  fileName: string | null;
}

export interface LessonCaption {
  id: string;
  language: string;
  label: string;
  url: string;
  fileName: string;
}

export type LessonReaction = 'like' | 'dislike';

export interface LessonComment {
  id: string;
  body: string;
  username: string;
  createdAt: string;
}

export interface LessonFeedback {
  lessonId: string;
  reaction: LessonReaction | null;
  counts: Record<LessonReaction, number>;
  comments: LessonComment[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Lesson {
  id: string;
  title: string;
  description: string;
  transcript: string;
  position: number;
  mediaId: string | null;
  mediaUrl: string | null;
  videoName: string | null;
  hasVideo: boolean;
  resources: LessonResource[];
  captions: LessonCaption[];
  completed: boolean;
  locked?: boolean;
}

export interface CourseModule {
  id: string;
  title: string;
  position: number;
  lessons: Lesson[];
  quiz: Quiz | null;
}

export interface Course {
  id: string;
  title: string;
  description: string;
  category: string;
  visibility: 'public' | 'private';
  status: 'draft' | 'published' | 'archived';
  coverMediaId: string | null;
  coverUrl: string | null;
  createdBy: string;
  owner: string;
  updatedAt: string;
  moduleCount: number;
  lessonCount: number;
  completedLessons: number;
  progress: number;
  completed: boolean;
  completionWindowDays?: number | null;
  deadlineAt?: string | null;
  versionNumber?: number | null;
  hasUnpublishedChanges?: boolean;
  reviewStatus?: 'draft' | 'in_review' | 'changes_requested' | null;
  modules?: CourseModule[];
}

export interface LearningPathCourse extends Course {
  position: number;
  requiresPrevious: boolean;
  unlocked: boolean;
}

export interface LearningPath {
  id: string;
  title: string;
  description: string;
  status: 'draft' | 'published' | 'archived';
  selfEnrollment: boolean;
  enrolled: boolean;
  completedCourses: number;
  courseCount: number;
  completed: boolean;
  courses: LearningPathCourse[];
}

export interface Competency {
  id: string;
  title: string;
  description: string;
  active: boolean | number;
  achieved?: boolean;
  completedCourses?: number;
  courseCount?: number;
  courses?: Array<{ id: string; title: string; completed: boolean }>;
}

export interface CourseDeadline {
  courseId: string;
  title: string;
  category: string;
  dueAt: string;
  status: 'upcoming' | 'overdue' | 'completed';
  completed: boolean;
  url: string;
}

export interface CourseVersion {
  id: string;
  course_id: string;
  storage_course_id: string;
  version_number: number;
  published_by: string | null;
  publisher?: string | null;
  published_at: string;
  requires_recompletion: number;
  change_note: string;
  title: string;
}

export interface CourseCertificate {
  id: string;
  courseId: string | null;
  courseVersionId?: string | null;
  certificateCode: string;
  recipientName: string;
  recipientEmail: string;
  courseTitle: string;
  platformName: string;
  issuedAt: string;
}

export interface CourseAnalytics {
  page: number;
  pageSize: number;
  course: Pick<Course, 'id' | 'title' | 'category' | 'status' | 'visibility'>;
  summary: {
    learnerCount: number;
    disabledLearnerCount: number;
    startedLearnerCount: number;
    completedLearnerCount: number;
    completionRate: number | null;
    averageProgress: number | null;
    lessonCount: number;
    quizCount: number;
    lessonCompletions: number;
    quizAttempts: number;
  };
  lessonMetrics: Array<{ id: string; title: string; moduleTitle: string; completedCount: number; completionRate: number | null }>;
  quizMetrics: Array<{
    id: string;
    title: string;
    moduleTitle: string;
    passMark: number;
    attempts: number;
    learnersAttempted: number;
    learnersPassed: number;
    participationRate: number | null;
    passRate: number | null;
    averageScore: number | null;
  }>;
  learners: Array<{
    id: string;
    username: string;
    disabled: boolean;
    enrolledAt: string | null;
    assignedAt: string | null;
    completedLessonCount: number;
    lessonCount: number;
    passedQuizCount: number;
    quizCount: number;
    progress: number;
    completed: boolean;
    started: boolean;
    lastActivityAt: string | null;
    lessonProgress: Array<{ id: string; title: string; moduleTitle: string; completedAt: string | null; completed: boolean }>;
    quizProgress: Array<{
      id: string;
      title: string;
      moduleTitle: string;
      passMark: number;
      attempts: number;
      highestScore: number | null;
      latestScore: number | null;
      latestPassed: boolean | null;
      passed: boolean;
      latestSubmittedAt: string | null;
    }>;
  }>;
}

export type CourseAnalyticsLearnerPage = Pick<CourseAnalytics, 'learners' | 'page' | 'pageSize'> & {
  learnerCount: number;
  disabledLearnerCount: number;
};

export interface CourseAccessUser {
  id: string;
  username: string;
  disabled: boolean;
  granted: boolean;
  grantedAt: string | null;
  grantedBy: string | null;
}
