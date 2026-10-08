import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, CircleHelp, Clock3, Filter, Play, Search } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, fetchCourse } from './api';
import { Button, CourseCard, CourseCover, CurriculumModule, EmptyState, PageHeading, ProgressBar } from './components';
import { useAuth } from './auth-context';
import type { Course, CourseModule, QuizAttempt } from './types';

type CourseListResponse = { courses: Course[]; categories?: string[] };

function ErrorNotice({ message }: { message: string }) {
  return <div className="error-notice" role="alert">{message}</div>;
}

export function CatalogPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All courses');
  const [sort, setSort] = useState('recent');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (category !== 'All courses') params.set('category', category);
      if (sort === 'title') params.set('sort', sort);
      const result = await api.get<CourseListResponse>(`/api/courses?${params.toString()}`);
      setCourses(result.courses); setCategories(result.categories || []);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Courses could not be loaded.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [category, sort]);

  return <div className="catalog-page">
    <PageHeading title="Browse courses" subtitle="Find a course to build your skills." />
    <div className="catalog-tools">
      <div className="filter-controls">
        <label className="select-wrap"><span className="sr-only">Course category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option>All courses</option>{categories.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={16} /></label>
        <label className="select-wrap"><span className="sr-only">Sort courses</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">Recently updated</option><option value="title">Course title</option></select><ChevronDown size={16} /></label>
      </div>
      <form className="search-field" onSubmit={(event) => { event.preventDefault(); load(); }}>
        <Search size={19} /><input aria-label="Search courses" placeholder="Search courses" value={query} onChange={(event) => setQuery(event.target.value)} /><button type="submit" aria-label="Submit search"><ArrowRight size={17} /></button>
      </form>
    </div>
    {error && <ErrorNotice message={error} />}
    {loading ? <div className="page-loading">Loading courses…</div> : courses.length ? <div className="course-grid">{courses.map((course) => <CourseCard key={course.id} course={course} />)}</div> : <EmptyState icon={<Filter size={24} />} title={query || category !== 'All courses' ? 'No matching courses' : 'No courses are available yet'} detail={query || category !== 'All courses' ? 'Try a different search or category.' : 'When courses are published for your learning space, they will appear here.'} />}
  </div>;
}

export function MyLearningPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<CourseListResponse>('/api/my-learning').then((result) => setCourses(result.courses))
      .catch((cause) => setError(cause instanceof ApiError ? cause.message : 'Your courses could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);
  return <div className="catalog-page my-learning-page">
    <PageHeading title="My learning" subtitle="Pick up where you left off." />
    {error && <ErrorNotice message={error} />}
    {loading ? <div className="page-loading">Loading your courses…</div> : courses.length ? <div className="course-grid">{courses.map((course) => <CourseCard key={course.id} course={course} continueLabel />)}</div> : <EmptyState title="Your learning starts here" detail="Open a course from the catalog to add it to your learning list." action={<Link className="button button-primary" to="/courses">Browse courses</Link>} />}
  </div>;
}

export function CourseOverviewPage() {
  const { courseId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetchCourse(courseId).then((result) => setCourse(result.course))
      .catch((cause) => setError(cause instanceof ApiError ? cause.message : 'This course could not be loaded.'))
      .finally(() => setLoading(false));
  }, [courseId]);

  async function startLearning() {
    if (!course) return;
    try {
      await api.post(`/api/courses/${course.id}/enroll`);
      const lesson = course.modules?.flatMap((module) => module.lessons).find((item) => !item.completed) || course.modules?.flatMap((module) => module.lessons)[0];
      if (lesson) navigate(`/courses/${course.id}/learn/${lesson.id}`);
      else setError('This course does not have any lessons yet.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Course access could not be started.'); }
  }

  if (loading) return <div className="page-loading">Loading course…</div>;
  if (!course) return <div className="narrow-content">{error && <ErrorNotice message={error} />}<Link className="back-link" to="/courses"><ArrowLeft size={17} />Back to courses</Link></div>;
  const lessons = course.modules?.flatMap((module) => module.lessons) || [];
  const nextLesson = lessons.find((lesson) => !lesson.completed) || lessons[0];
  return <div className="course-overview">
    <div className="breadcrumbs"><Link to="/courses">Browse courses</Link><span>/</span><span>{course.title}</span></div>
    {error && <ErrorNotice message={error} />}
    <section className="course-hero">
      <div className="course-hero-copy">
        <span className="category-label">{course.category}</span>
        <h1>{course.title}</h1>
        <p>{course.description || 'A practical course for your learning journey.'}</p>
        <div className="course-hero-meta"><span><BookOpen size={17} />{course.moduleCount} {course.moduleCount === 1 ? 'module' : 'modules'}</span><span><Play size={15} />{course.lessonCount} lessons</span></div>
        <div className="course-hero-actions">
          <Button onClick={startLearning} disabled={!nextLesson}>{course.progress > 0 ? 'Continue learning' : 'Start learning'}<ArrowRight size={17} /></Button>
          {course.progress > 0 && <span className="progress-caption">{course.completed ? 'Course completed' : `${course.progress}% complete`}</span>}
        </div>
      </div>
      <CourseCover course={course} className="course-hero-cover" />
    </section>
    <section className="course-overview-body">
      <div className="course-description-block"><h2>About this course</h2><p>{course.description || 'Explore the lessons and practical knowledge in this course.'}</p></div>
      <div className="course-curriculum-block">
        <div className="section-heading-row"><div><h2>Course content</h2><p>{course.moduleCount} modules <span>·</span> {course.lessonCount} lessons</p></div>{course.progress > 0 && <div className="course-progress-summary"><span>{course.completedLessons} of {course.lessonCount} lessons complete</span><ProgressBar value={course.progress} /></div>}</div>
        {course.modules?.map((module) => <CurriculumModule key={module.id} module={module} courseId={course.id} />)}
      </div>
    </section>
    <div className="course-bottom-cta"><span>{user?.username ? `Ready when you are, ${user.username}.` : 'Ready when you are.'}</span><Button onClick={startLearning} disabled={!nextLesson}>{course.progress > 0 ? 'Continue learning' : 'Start learning'}<ArrowRight size={17} /></Button></div>
  </div>;
}

function orderedLessons(modules: CourseModule[]) {
  return modules.flatMap((module) => module.lessons.map((lesson) => ({ ...lesson, moduleTitle: module.title })));
}

export function CoursePlayerPage() {
  const { courseId = '', lessonId = '' } = useParams();
  const navigate = useNavigate();
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [railOpen, setRailOpen] = useState(true);

  async function load() {
    setLoading(true); setError('');
    try { setCourse((await fetchCourse(courseId)).course); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'This course could not be loaded.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [courseId]);

  const modules = course?.modules || [];
  const lessons = useMemo(() => orderedLessons(modules), [modules]);
  const currentIndex = lessons.findIndex((lesson) => lesson.id === lessonId);
  const current = lessons[currentIndex];
  const previous = currentIndex > 0 ? lessons[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < lessons.length - 1 ? lessons[currentIndex + 1] : null;

  async function toggleCompleted() {
    if (!current) return;
    setSaving(true); setError('');
    try {
      if (current.completed) await api.delete(`/api/lessons/${current.id}/completion`);
      else await api.put(`/api/lessons/${current.id}/completion`);
      await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Progress could not be saved.'); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="page-loading">Loading lesson…</div>;
  if (!course || !current) return <div className="narrow-content">{error && <ErrorNotice message={error} />}<Link className="back-link" to={`/courses/${courseId}`}><ArrowLeft size={17} />Back to course</Link></div>;

  return <div className={`player-layout ${railOpen ? '' : 'player-layout-wide'}`}>
    <div className="player-main-column">
      <div className="player-breadcrumb"><Link to={`/courses/${course.id}`}>{course.title}</Link><span>/</span><span>{current.moduleTitle}</span></div>
      {error && <ErrorNotice message={error} />}
      <div className="player-heading"><div><p>{current.moduleTitle}</p><h1>{current.title}</h1></div><button className="rail-toggle" type="button" onClick={() => setRailOpen(!railOpen)} aria-label={railOpen ? 'Hide course content' : 'Show course content'}><ChevronDown size={18} /></button></div>
      <section className="video-stage">
        {current.hasVideo && current.mediaUrl ? <video controls playsInline preload="metadata" src={current.mediaUrl} poster={course.coverUrl || undefined} aria-label={current.title} /> : <div className="video-missing"><Play size={36} /><span>Video not available</span></div>}
      </section>
      <div className="player-controls-row">
        <button className="button button-secondary" type="button" disabled={!previous} onClick={() => previous && navigate(`/courses/${course.id}/learn/${previous.id}`)}><ArrowLeft size={17} />Previous lesson</button>
        <Button variant={current.completed ? 'secondary' : 'primary'} disabled={saving} onClick={toggleCompleted}>{current.completed ? <><Check size={17} />Completed</> : 'Mark lesson complete'}</Button>
        <button className="button button-secondary" type="button" disabled={!next} onClick={() => next && navigate(`/courses/${course.id}/learn/${next.id}`)}>Next lesson<ArrowRight size={17} /></button>
      </div>
      <section className="lesson-notes"><h2>About this lesson</h2><p>{current.description || 'Work through this lesson at your own pace. Mark it complete when you are ready to continue.'}</p></section>
    </div>
    {railOpen && <aside className="course-rail"><div className="course-rail-head"><div><span>Course content</span><small>{course.progress}% complete</small></div><button aria-label="Hide course content" onClick={() => setRailOpen(false)}><ChevronDown size={18} /></button></div><ProgressBar value={course.progress} />
      {modules.map((module) => <CurriculumModule key={module.id} module={module} selectedLessonId={lessonId} courseId={course.id} compact />)}
    </aside>}
  </div>;
}

export function QuizPage() {
  const { courseId = '', quizId = '' } = useParams();
  const [course, setCourse] = useState<Course | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizAttempt | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetchCourse(courseId).then(({ course: data }) => setCourse(data))
      .catch((cause) => setError(cause instanceof ApiError ? cause.message : 'This quiz could not be loaded.'))
      .finally(() => setLoading(false));
  }, [courseId]);
  const quiz = course?.modules?.find((module) => module.quiz?.id === quizId)?.quiz;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!quiz) return;
    setError(''); setSaving(true);
    try {
      const response = await api.post<{ attempt: QuizAttempt }>(`/api/quizzes/${quiz.id}/attempts`, { answers });
      setResult(response.attempt);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Your quiz could not be submitted.'); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="page-loading">Loading quiz…</div>;
  if (!course || !quiz) return <div className="narrow-content">{error && <ErrorNotice message={error} />}<Link className="back-link" to={`/courses/${courseId}`}><ArrowLeft size={17} />Back to course</Link></div>;
  const questionsToShow = result?.questions || quiz.questions;
  const allAnswered = quiz.questions.length > 0 && quiz.questions.every((question) => answers[question.id || '']);

  return <div className="quiz-page">
    <div className="breadcrumbs"><Link to={`/courses/${course.id}`}>{course.title}</Link><span>/</span><span>{quiz.title}</span></div>
    <div className="quiz-layout">
      <div className="quiz-main">
        <div className="quiz-topline"><span>{quiz.questions.length} questions</span><span>Pass mark {quiz.passMark}%</span></div>
        <h1>{quiz.title}</h1>
        {!result ? <><p className="lead-copy">Choose one answer for each question. You can retry this quiz if you need another attempt.</p>
          {error && <ErrorNotice message={error} />}
          <form onSubmit={submit} className="quiz-form">
            {quiz.questions.map((question, index) => <fieldset className="question-block" key={question.id || index}>
              <legend><span className="question-number">{String(index + 1).padStart(2, '0')}</span>{question.prompt}</legend>
              <div className="quiz-choices">{question.choices.map((choice, choiceIndex) => <label className={`quiz-choice ${answers[question.id || ''] === choice.id ? 'choice-selected' : ''}`} key={choice.id || choiceIndex}><input type="radio" name={question.id} value={choice.id} checked={answers[question.id || ''] === choice.id} onChange={() => setAnswers({ ...answers, [question.id || '']: choice.id || '' })} /><span className="choice-letter">{String.fromCharCode(65 + choiceIndex)}</span><span>{choice.text}</span></label>)}</div>
            </fieldset>)}
            {!quiz.questions.length && <EmptyState icon={<CircleHelp size={24} />} title="This quiz is being prepared" detail="Check back when your course moderator has added questions." />}
            <Button type="submit" disabled={!allAnswered || saving}>{saving ? 'Checking answers…' : 'Submit answers'}<ArrowRight size={17} /></Button>
          </form>
        </> : <div className="quiz-results">
          <div className={`score-panel ${result.passed ? 'score-pass' : 'score-retry'}`}><span className="score-icon">{result.passed ? <Check size={22} /> : <Clock3 size={22} />}</span><div><span className="score-label">{result.passed ? 'Quiz passed' : 'Keep practicing'}</span><strong>{result.score}%</strong><small>{result.passed ? `You reached the ${result.passMark}% pass mark.` : `You need ${result.passMark}% to pass.`}</small></div></div>
          <h2>Review your answers</h2>
          {questionsToShow.map((question, index) => {
            const attemptQuestion = question as NonNullable<QuizAttempt['questions']>[number];
            const correctChoiceId = attemptQuestion.correctChoiceId;
            const selectedChoiceId = attemptQuestion.selectedChoiceId;
            return <div className="result-question" key={question.id || index}><h3>{index + 1}. {question.prompt}</h3><p className={selectedChoiceId === correctChoiceId ? 'answer-correct' : 'answer-incorrect'}>{question.choices.find((choice) => choice.id === selectedChoiceId)?.text || 'No answer selected'}</p>{correctChoiceId !== selectedChoiceId && <p className="correct-answer">Correct answer: {question.choices.find((choice) => choice.id === correctChoiceId)?.text}</p>}{question.explanation && <p className="answer-explanation">{question.explanation}</p>}</div>;
          })}
          <div className="quiz-result-actions"><Button variant="secondary" onClick={() => { setAnswers({}); setResult(null); }}>Try again</Button><Link className="button button-primary" to={`/courses/${course.id}`}>Back to course</Link></div>
        </div>}
      </div>
      <aside className="quiz-aside"><span className="quiz-aside-label">Course progress</span><strong>{course.progress}%</strong><ProgressBar value={course.progress} /><p>Complete lessons and pass module quizzes to finish this course.</p><Link to={`/courses/${course.id}`}>View course content<ArrowRight size={16} /></Link></aside>
    </div>
  </div>;
}

