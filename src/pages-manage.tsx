import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, Check, ChevronDown, CircleHelp, FileText, Link2, LockKeyhole, MoreVertical, Pencil, Plus, Search, Settings2, Trash2, Upload } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, fetchAccess, fetchCourse } from './api';
import { Button, CourseStatus, EmptyState, PageHeading, PalettePicker, PlatformIconPicker, UserInitial, VisibilityLabel } from './components';
import type { BrandingPalette, ConnectionProtocol } from './branding';
import { useAuth } from './auth-context';
import type { Course, CourseAccessUser, CourseModule, Lesson, LessonResource, QuizQuestion, Role, User } from './types';

type CourseListResponse = { courses: Course[] };

function Notice({ children, kind = 'error' }: { children: React.ReactNode; kind?: 'error' | 'success' }) {
  return <div className={`inline-notice inline-notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

function DateText({ value }: { value: string }) {
  const date = new Date(value.includes('Z') ? value : `${value.replace(' ', 'T')}Z`);
  return <span>{Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)}</span>;
}

export function CourseManagementPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (status !== 'all') params.set('status', status);
      if (query.trim()) params.set('q', query.trim());
      setCourses((await api.get<CourseListResponse>(`/api/manage/courses?${params}`)).courses);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Courses could not be loaded.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [status]);

  async function changeStatus(course: Course, nextStatus: Course['status']) {
    setBusyId(course.id); setError('');
    try { await api.patch(`/api/manage/courses/${course.id}`, { status: nextStatus }); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Course status could not be changed.'); }
    finally { setBusyId(''); }
  }

  async function deleteCourse(course: Course) {
    if (!window.confirm(`Permanently delete “${course.title}” and its uploaded media? This cannot be undone.`)) return;
    setBusyId(course.id); setError('');
    try { await api.delete(`/api/manage/courses/${course.id}`); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Course could not be deleted.'); }
    finally { setBusyId(''); }
  }

  const tabs = [
    { label: 'All courses', value: 'all' }, { label: 'Published', value: 'published' },
    { label: 'Drafts', value: 'draft' }, { label: 'Archived', value: 'archived' },
  ];
  return <div className="management-page">
    <PageHeading title="Courses" action={<Link className="button button-primary" to="/manage/courses/new"><Plus size={18} />Create course</Link>} />
    <div className="management-tabs" role="group" aria-label="Filter courses by status">
      {tabs.map((tab) => <button type="button" key={tab.value} aria-pressed={status === tab.value} className={status === tab.value ? 'active' : ''} onClick={() => setStatus(tab.value)}>{tab.label}</button>)}
    </div>
    <form className="management-search" onSubmit={(event) => { event.preventDefault(); load(); }}><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search courses" aria-label="Search courses" /><button type="submit">Search</button></form>
    {error && <Notice>{error}</Notice>}
    {loading ? <div className="page-loading">Loading courses…</div> : courses.length ? <div className="course-table-wrap"><table className="course-table"><thead><tr><th>Course</th><th>Owner</th><th>Visibility</th><th>Status</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {courses.map((course) => <tr key={course.id}>
        <td><div className="table-course"><span className="table-thumb">{course.coverUrl ? <img src={course.coverUrl} alt="" /> : <BookOpen size={20} />}</span><div><Link to={`/manage/courses/${course.id}/edit`}>{course.title}</Link><small>{course.category}</small></div></div></td>
        <td><span className="owner-cell"><UserInitial username={course.owner || ''} />{course.owner}</span></td>
        <td><VisibilityLabel visibility={course.visibility} /></td>
        <td><CourseStatus status={course.status} /></td>
        <td><DateText value={course.updatedAt} /></td>
        <td><div className="table-actions"><Link className="text-action" to={`/manage/courses/${course.id}/edit`}>Edit</Link>{course.visibility === 'private' && <Link className="text-action" to={`/manage/courses/${course.id}/access`}>Manage access</Link>}
          <details className="row-menu"><summary aria-label={`More actions for ${course.title}`}><MoreVertical size={18} /></summary><div className="row-menu-popover">
            {course.status === 'draft' && <button onClick={() => changeStatus(course, 'published')} disabled={busyId === course.id}>Publish</button>}
            {course.status === 'published' && <button onClick={() => changeStatus(course, 'draft')} disabled={busyId === course.id}>Unpublish</button>}
            {course.status !== 'archived' && <button onClick={() => changeStatus(course, 'archived')} disabled={busyId === course.id}>Archive</button>}
            {course.status === 'archived' && <button className="danger-menu-item" onClick={() => deleteCourse(course)} disabled={busyId === course.id}>Delete permanently</button>}
          </div></details></div></td>
      </tr>)}
    </tbody></table></div> : <EmptyState title={query ? 'No matching courses' : 'Your course catalog is ready'} detail={query ? 'Try another search term.' : 'Create a course, add modules and video lessons, then publish it for learners.'} action={!query && <Link className="button button-primary" to="/manage/courses/new"><Plus size={17} />Create course</Link>} />}
  </div>;
}

function QuizEditor({ module, onSaved, onError }: { module: CourseModule; onSaved: () => void | Promise<void>; onError: (message: string) => void }) {
  const existing = module.quiz;
  const [title, setTitle] = useState(existing?.title || `${module.title} quiz`);
  const [passMark, setPassMark] = useState(existing?.passMark ?? 70);
  const [questions, setQuestions] = useState<QuizQuestion[]>(existing?.questions || []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(existing?.title || `${module.title} quiz`);
    setPassMark(existing?.passMark ?? 70);
    setQuestions(existing?.questions || []);
  }, [module.id, module.title, existing?.id]);

  function updateQuestion(index: number, patch: Partial<QuizQuestion>) {
    setQuestions((current) => current.map((question, itemIndex) => itemIndex === index ? { ...question, ...patch } : question));
  }
  function updateChoice(questionIndex: number, choiceIndex: number, patch: { text?: string; isCorrect?: boolean }) {
    setQuestions((current) => current.map((question, itemIndex) => {
      if (itemIndex !== questionIndex) return question;
      return { ...question, choices: question.choices.map((choice, itemChoice) => ({ ...choice, ...(itemChoice === choiceIndex ? patch : {}), ...(patch.isCorrect && itemChoice !== choiceIndex ? { isCorrect: false } : {}) })) };
    }));
  }
  async function save() {
    setSaving(true);
    try {
      await api.put(`/api/manage/modules/${module.id}/quiz`, { title, passMark: Number(passMark), questions });
      await onSaved();
    } catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Quiz could not be saved.'); }
    finally { setSaving(false); }
  }
  async function remove() {
    if (!existing || !window.confirm('Remove this quiz from the module? Saved attempts will also be removed.')) return;
    try { await api.delete(`/api/manage/modules/${module.id}/quiz`); await onSaved(); }
    catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Quiz could not be removed.'); }
  }

  return <div className="quiz-editor">
    <div className="quiz-editor-head"><div><span className="editor-type"><CircleHelp size={15} />Module quiz</span><h4>{existing ? 'Edit quiz' : 'Add a quiz'}</h4></div>{existing && <button type="button" className="icon-button danger-icon" aria-label="Remove quiz" onClick={remove}><Trash2 size={16} /></button>}</div>
    <div className="quiz-settings-row"><label>Quiz title<input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} /></label><label>Pass mark<select value={passMark} onChange={(event) => setPassMark(Number(event.target.value))}>{[50, 60, 70, 80, 90, 100].map((value) => <option key={value} value={value}>{value}%</option>)}</select></label></div>
    {questions.map((question, questionIndex) => <div className="question-editor" key={question.id || questionIndex}>
      <div className="question-editor-head"><span>Question {questionIndex + 1}</span><button type="button" className="text-action danger-text" onClick={() => setQuestions(questions.filter((_, index) => index !== questionIndex))}>Remove</button></div>
      <label className="sr-only" htmlFor={`question-${module.id}-${questionIndex}`}>Question text</label><textarea id={`question-${module.id}-${questionIndex}`} rows={2} placeholder="Write a question" value={question.prompt} onChange={(event) => updateQuestion(questionIndex, { prompt: event.target.value })} />
      <p className="form-hint">Select the radio button beside the correct answer.</p>
      {question.choices.map((choice, choiceIndex) => <div className="choice-editor-row" key={choice.id || choiceIndex}><input type="radio" name={`correct-${module.id}-${questionIndex}`} checked={Boolean(choice.isCorrect)} onChange={() => updateChoice(questionIndex, choiceIndex, { isCorrect: true })} aria-label={`Mark answer ${choiceIndex + 1} correct`} /><input value={choice.text} maxLength={500} onChange={(event) => updateChoice(questionIndex, choiceIndex, { text: event.target.value })} aria-label={`Answer choice ${choiceIndex + 1}`} placeholder={`Answer ${choiceIndex + 1}`} /><button type="button" className="icon-button danger-icon" aria-label="Remove answer choice" onClick={() => updateQuestion(questionIndex, { choices: question.choices.filter((_, index) => index !== choiceIndex) })}><Trash2 size={15} /></button></div>)}
      {question.choices.length < 6 && <button className="text-action add-choice" type="button" onClick={() => updateQuestion(questionIndex, { choices: [...question.choices, { text: '', isCorrect: false }] })}><Plus size={15} />Add answer choice</button>}
      <label className="explanation-label">Explanation (optional)<input value={question.explanation || ''} maxLength={1000} onChange={(event) => updateQuestion(questionIndex, { explanation: event.target.value })} /></label>
    </div>)}
    <div className="quiz-editor-actions"><button className="text-action" type="button" onClick={() => setQuestions([...questions, { prompt: '', choices: [{ text: '', isCorrect: true }, { text: '', isCorrect: false }] }])}><Plus size={16} />Add question</button><Button variant="secondary" type="button" disabled={saving} onClick={save}>{saving ? 'Saving quiz…' : 'Save quiz'}</Button></div>
  </div>;
}

function LessonDetailsEditor({ lesson, courseId, beforeChange, onChanged, onClose, onError, onNotice }: {
  lesson: Lesson;
  courseId: string;
  beforeChange: () => Promise<void>;
  onChanged: () => Promise<void>;
  onClose: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [title, setTitle] = useState(lesson.title);
  const [description, setDescription] = useState(lesson.description);
  const [resources, setResources] = useState<LessonResource[]>(lesson.resources || []);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  useEffect(() => {
    setTitle(lesson.title);
    setDescription(lesson.description);
    setResources(lesson.resources || []);
  }, [lesson.id, lesson.title, lesson.description, lesson.resources]);

  async function persistLessonDetails() {
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new ApiError(400, 'Lesson title is required.');
    await beforeChange();
    await api.patch(`/api/manage/lessons/${lesson.id}`, { title: cleanTitle, description });
    setTitle(cleanTitle);
  }

  async function saveDetails(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); onError('');
    try {
      await persistLessonDetails();
      await onChanged();
      onNotice('Lesson details saved.');
    } catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Lesson details could not be saved.'); }
    finally { setBusy(false); }
  }

  async function addLink(event: React.FormEvent) {
    event.preventDefault();
    if (!linkTitle.trim() || !linkUrl.trim()) return;
    setBusy(true); onError('');
    try {
      await persistLessonDetails();
      const { resource } = await api.post<{ resource: LessonResource }>(`/api/manage/lessons/${lesson.id}/resources`, { title: linkTitle.trim(), url: linkUrl.trim() });
      setResources((current) => [...current, resource]);
      await onChanged();
      setLinkTitle(''); setLinkUrl('');
      onNotice('Lesson link added.');
    } catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Lesson link could not be added.'); }
    finally { setBusy(false); }
  }

  async function uploadDocument(file: File) {
    setBusy(true); setUploadProgress(0); onError('');
    try {
      await persistLessonDetails();
      const titleFromFile = (file.name.replace(/\.[^.]+$/, '').trim() || file.name).slice(0, 160);
      const { resource } = await api.upload<{ resource: LessonResource }>(`/api/manage/courses/${courseId}/lesson-documents`, {
        kind: 'document', lessonId: lesson.id, title: titleFromFile,
      }, file, setUploadProgress);
      setResources((current) => [...current, resource]);
      await onChanged();
      onNotice(`${file.name} attached to this lesson.`);
    } catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Document could not be uploaded.'); }
    finally { setBusy(false); setUploadProgress(null); }
  }

  async function removeResource(resource: LessonResource) {
    if (!window.confirm(`Remove “${resource.title}” from this lesson?`)) return;
    setBusy(true); onError('');
    try {
      await persistLessonDetails();
      await api.delete(`/api/manage/lessons/${lesson.id}/resources/${resource.id}`);
      setResources((current) => current.filter((item) => item.id !== resource.id));
      await onChanged();
      onNotice('Lesson resource removed.');
    } catch (cause) { onError(cause instanceof ApiError ? cause.message : 'Lesson resource could not be removed.'); }
    finally { setBusy(false); }
  }

  return <div id={`lesson-details-${lesson.id}`} className="lesson-details-editor">
    <div className="lesson-details-heading"><div><strong>Lesson details</strong><span>Set what learners will see for this lesson.</span></div><button type="button" className="text-action" onClick={onClose}>Close</button></div>
    <form className="lesson-details-form" onSubmit={saveDetails}>
      <div className="lesson-details-grid">
        <label>Lesson title<input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} required /></label>
        <label>Lesson description<textarea value={description} maxLength={2000} rows={3} onChange={(event) => setDescription(event.target.value)} placeholder="Add context, learning goals, or notes for this lesson." /></label>
      </div>
      <div className="lesson-details-save"><Button type="submit" variant="secondary" disabled={busy}>{busy ? 'Saving…' : 'Save lesson details'}</Button></div>
    </form>

    <section className="lesson-resource-editor" aria-label="Lesson links and documents">
      <div className="lesson-resource-heading"><div><strong>Links and documents</strong><span>These resources will be available to learners alongside the lesson.</span></div></div>
      {resources.length ? <ul className="lesson-resource-list">{resources.map((resource) => <li className="lesson-resource-row" key={resource.id}>
        {resource.kind === 'link' ? <Link2 size={16} /> : <FileText size={16} />}
        <div><strong>{resource.title}</strong><small>{resource.kind === 'document' ? resource.fileName : resource.url}</small></div>
        <button type="button" className="icon-button danger-icon" title={`Remove ${resource.title}`} aria-label={`Remove ${resource.title}`} disabled={busy} onClick={() => removeResource(resource)}><Trash2 size={15} /></button>
      </li>)}</ul> : <p className="lesson-resource-empty">No resources added yet.</p>}
      <form className="lesson-link-form" onSubmit={addLink}>
        <label>Link title<input value={linkTitle} maxLength={160} onChange={(event) => setLinkTitle(event.target.value)} placeholder="e.g. Reference guide" required /></label>
        <label>Link URL<input type="url" value={linkUrl} maxLength={2048} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://example.com/resource" required /></label>
        <Button type="submit" variant="secondary" disabled={busy || !linkTitle.trim() || !linkUrl.trim()}><Link2 size={15} />Add link</Button>
      </form>
      <div className="lesson-document-upload">
        <div><strong>Attach a document</strong><span>PDF, text, Word, PowerPoint, Excel, CSV/TSV, or OpenDocument.</span></div>
        <label className="button button-secondary file-button"><Upload size={15} />Choose document<input type="file" accept=".pdf,.txt,.md,.rtf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.tsv,.odt,.odp,.ods" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadDocument(file); event.currentTarget.value = ''; }} /></label>
        {uploadProgress !== null && <div className="upload-progress lesson-document-progress"><span style={{ width: `${uploadProgress}%` }} /><small>{uploadProgress}%</small></div>}
      </div>
    </section>
  </div>;
}

export function CourseEditorPage() {
  const route = useParams();
  const navigate = useNavigate();
  const [courseId, setCourseId] = useState(route.courseId || '');
  const [course, setCourse] = useState<Course | null>(null);
  const [title, setTitle] = useState('Untitled course');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [visibility, setVisibility] = useState<Course['visibility']>('public');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [moduleTitle, setModuleTitle] = useState('');
  const [addingModule, setAddingModule] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingLessonId, setEditingLessonId] = useState('');
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [coverProgress, setCoverProgress] = useState<number | null>(null);

  async function load(id = courseId) {
    if (!id) return;
    try {
      const response = await fetchCourse(id, true);
      setCourse(response.course); setTitle(response.course.title); setDescription(response.course.description); setCategory(response.course.category); setVisibility(response.course.visibility);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Course could not be loaded.'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    if (route.courseId) { setCourseId(route.courseId); load(route.courseId); return () => { active = false; }; }
    api.post<{ course: Course }>('/api/manage/courses', { title: 'Untitled course', description: '', category: 'General', visibility: 'public' })
      .then((response) => {
        if (!active) return;
        setCourseId(response.course.id);
        navigate(`/manage/courses/${response.course.id}/edit`, { replace: true });
        setCourse(response.course); setTitle(response.course.title); setDescription(response.course.description); setCategory(response.course.category); setVisibility(response.course.visibility);
      }).catch((cause) => setError(cause instanceof ApiError ? cause.message : 'Course could not be created.')).finally(() => setLoading(false));
    return () => { active = false; };
  }, [route.courseId]);

  async function saveCourse(status?: Course['status']) {
    if (!courseId) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await api.patch<{ course: Course }>(`/api/manage/courses/${courseId}`, { title, description, category, visibility, ...(status ? { status } : {}) });
      setCourse(response.course); setNotice(status === 'published' ? 'Course published for learners.' : status === 'draft' ? 'Draft saved.' : 'Course details saved.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Course could not be saved.'); }
    finally { setSaving(false); }
  }

  async function saveCourseDetailsIfChanged() {
    if (!courseId || !course) return;
    if (title === course.title && description === course.description && category === course.category && visibility === course.visibility) return;
    const response = await api.patch<{ course: Course }>(`/api/manage/courses/${courseId}`, { title, description, category, visibility });
    setCourse(response.course);
  }

  async function addModule(event: React.FormEvent) {
    event.preventDefault(); if (!moduleTitle.trim() || !courseId) return;
    setError('');
    try {
      await saveCourseDetailsIfChanged();
      await api.post(`/api/manage/courses/${courseId}/modules`, { title: moduleTitle.trim() });
      setModuleTitle(''); setAddingModule(false); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Module could not be added.'); }
  }

  async function addLesson(moduleId: string) {
    setError('');
    try { await saveCourseDetailsIfChanged(); await api.post(`/api/manage/modules/${moduleId}/lessons`, { title: 'New lesson' }); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Lesson could not be added.'); }
  }

  async function editModule(module: CourseModule) {
    const nextTitle = window.prompt('Module title', module.title);
    if (!nextTitle?.trim() || nextTitle.trim() === module.title) return;
    try { await saveCourseDetailsIfChanged(); await api.patch(`/api/manage/modules/${module.id}`, { title: nextTitle.trim() }); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Module could not be updated.'); }
  }

  async function deleteModule(module: CourseModule) {
    if (!window.confirm(`Remove “${module.title}” and all of its lessons and quiz?`)) return;
    try { await saveCourseDetailsIfChanged(); await api.delete(`/api/manage/modules/${module.id}`); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Module could not be removed.'); }
  }

  async function deleteLesson(lessonId: string, currentTitle: string) {
    if (!window.confirm(`Remove “${currentTitle}”, its video, and its lesson resources?`)) return;
    try { await saveCourseDetailsIfChanged(); await api.delete(`/api/manage/lessons/${lessonId}`); setEditingLessonId(''); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Lesson could not be removed.'); }
  }

  async function moveItem(path: string, direction: 'up' | 'down') {
    try { await saveCourseDetailsIfChanged(); await api.post(path, { direction }); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Order could not be updated.'); }
  }

  async function uploadVideo(lessonId: string, file: File) {
    setError(''); setUploading((current) => ({ ...current, [lessonId]: 0 }));
    try {
      await saveCourseDetailsIfChanged();
      await api.upload(`/api/manage/courses/${courseId}/media`, { kind: 'video', lessonId }, file, (progress) => setUploading((current) => ({ ...current, [lessonId]: progress })));
      await load(); setNotice(`${file.name} uploaded.`);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Video could not be uploaded.'); }
    finally { setUploading((current) => { const next = { ...current }; delete next[lessonId]; return next; }); }
  }

  async function uploadCover(file: File) {
    setError(''); setCoverProgress(0);
    try { await saveCourseDetailsIfChanged(); await api.upload(`/api/manage/courses/${courseId}/media`, { kind: 'cover' }, file, setCoverProgress); await load(); setNotice('Course cover uploaded.'); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Course cover could not be uploaded.'); }
    finally { setCoverProgress(null); }
  }

  if (loading) return <div className="page-loading">Loading course editor…</div>;
  if (!course) return <div className="management-page">{error && <Notice>{error}</Notice>}<Link className="back-link" to="/manage/courses"><ArrowLeft size={17} />Back to courses</Link></div>;

  return <div className="editor-page">
    <div className="editor-topbar"><div><div className="breadcrumbs"><Link to="/manage/courses">Courses</Link><span>/</span><span>Edit course</span></div><h1>{course.title || 'Edit course'}</h1></div><div className="editor-actions"><CourseStatus status={course.status} /><Button variant="secondary" onClick={() => saveCourse('draft')} disabled={saving}>Save draft</Button><Button onClick={() => saveCourse('published')} disabled={saving}>Publish course</Button></div></div>
    {error && <Notice>{error}</Notice>}{notice && <Notice kind="success">{notice}</Notice>}
    <p className="published-edit-note">Changes to a published course are visible to learners as you save them.</p>
    <section className="editor-section course-details-form">
      <div className="editor-field-grid"><label className="field-wide">Course title<input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} placeholder="Give your course a clear title" /></label>
        <label>Category<input value={category} maxLength={100} onChange={(event) => setCategory(event.target.value)} placeholder="e.g. Professional development" /></label>
        <fieldset className="visibility-field"><legend>Visibility</legend><label><input type="radio" name="visibility" checked={visibility === 'public'} onChange={() => setVisibility('public')} />Public</label><label><input type="radio" name="visibility" checked={visibility === 'private'} onChange={() => setVisibility('private')} />Private</label></fieldset>
        <label className="field-wide">Description<textarea rows={3} maxLength={6000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What will learners understand or be able to do after this course?" /></label>
      </div>
      <div className="cover-upload-row"><div>{course.coverUrl ? <img src={course.coverUrl} alt="Course cover preview" /> : <span className="cover-preview-empty"><BookOpen size={22} /></span>}<div><strong>Course cover</strong><small>JPG, PNG, or WebP</small></div></div><label className="button button-secondary file-button"><Upload size={16} />{course.coverUrl ? 'Replace cover' : 'Upload cover'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadCover(file); event.currentTarget.value = ''; }} /></label>{coverProgress !== null && <span className="upload-percent">{coverProgress}%</span>}</div>
    </section>
    <section className="editor-section curriculum-editor-section">
      <div className="curriculum-editor-title"><div><h2>Course curriculum</h2><p>Organize lessons into modules and add a quiz when you are ready.</p></div><div className="curriculum-editor-actions"><Button variant="secondary" onClick={() => setAddingModule(!addingModule)}><Plus size={17} />Add module</Button></div></div>
      {addingModule && <form className="inline-add-form" onSubmit={addModule}><input autoFocus value={moduleTitle} onChange={(event) => setModuleTitle(event.target.value)} placeholder="Module title" aria-label="Module title" maxLength={160} /><Button type="submit" disabled={!moduleTitle.trim()}>Add module</Button><button type="button" className="text-action" onClick={() => setAddingModule(false)}>Cancel</button></form>}
      <div className="module-editor-list">
        {course.modules?.map((module, moduleIndex) => <div className="module-editor" key={module.id}>
          <div className="module-editor-heading"><button type="button" className="module-disclosure" onClick={() => setExpanded({ ...expanded, [module.id]: !(expanded[module.id] ?? true) })} aria-label={`${expanded[module.id] ?? true ? 'Collapse' : 'Expand'} ${module.title}`}><ChevronDown className={(expanded[module.id] ?? true) ? '' : 'chevron-collapsed'} size={18} /></button><BookOpen size={18} /><button type="button" className="module-name-button" onClick={() => editModule(module)}>{module.title}</button><span className="module-item-count">{module.lessons.length + (module.quiz ? 1 : 0)} items</span><div className="module-tools"><button title="Move module up" disabled={moduleIndex === 0} onClick={() => moveItem(`/api/manage/modules/${module.id}/move`, 'up')}><ArrowUp size={16} /></button><button title="Move module down" disabled={moduleIndex === (course.modules?.length || 0) - 1} onClick={() => moveItem(`/api/manage/modules/${module.id}/move`, 'down')}><ArrowDown size={16} /></button><button title="Remove module" className="danger-icon" onClick={() => deleteModule(module)}><Trash2 size={16} /></button></div></div>
          {(expanded[module.id] ?? true) && <div className="module-editor-content">
            {module.lessons.map((lesson, lessonIndex) => <div className="lesson-editor-item" key={lesson.id}>
              <div className="lesson-editor-row">
                <span className="lesson-grip"><FileText size={17} /></span><button type="button" className="lesson-name-button" aria-expanded={editingLessonId === lesson.id} aria-controls={editingLessonId === lesson.id ? `lesson-details-${lesson.id}` : undefined} onClick={() => setEditingLessonId(editingLessonId === lesson.id ? '' : lesson.id)}>{lesson.title}</button>
                {lesson.hasVideo ? <span className="video-file-label"><Check size={15} />{lesson.videoName}</span> : <label className="button button-upload-small file-button"><Upload size={15} />Upload video<input type="file" accept="video/mp4,.mp4" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadVideo(lesson.id, file); event.currentTarget.value = ''; }} /></label>}
                {uploading[lesson.id] !== undefined && <div className="upload-progress"><span style={{ width: `${uploading[lesson.id]}%` }} /><small>{uploading[lesson.id]}%</small></div>}
                <div className="lesson-tools"><button type="button" className="lesson-edit-action" title="Edit lesson details" aria-label={`Edit details for ${lesson.title}`} aria-expanded={editingLessonId === lesson.id} aria-controls={editingLessonId === lesson.id ? `lesson-details-${lesson.id}` : undefined} onClick={() => setEditingLessonId(editingLessonId === lesson.id ? '' : lesson.id)}><Pencil size={14} /><span>Details</span></button><button type="button" title="Move lesson up" disabled={lessonIndex === 0} onClick={() => moveItem(`/api/manage/lessons/${lesson.id}/move`, 'up')}><ArrowUp size={15} /></button><button type="button" title="Move lesson down" disabled={lessonIndex === module.lessons.length - 1} onClick={() => moveItem(`/api/manage/lessons/${lesson.id}/move`, 'down')}><ArrowDown size={15} /></button><button type="button" title="Remove lesson" className="danger-icon" onClick={() => deleteLesson(lesson.id, lesson.title)}><Trash2 size={15} /></button></div>
              </div>
              {editingLessonId === lesson.id && <LessonDetailsEditor lesson={lesson} courseId={courseId} beforeChange={saveCourseDetailsIfChanged} onChanged={load} onClose={() => setEditingLessonId('')} onError={setError} onNotice={setNotice} />}
            </div>)}
            <div className="module-add-actions"><button type="button" className="text-action" onClick={() => addLesson(module.id)}><Plus size={15} />Add lesson</button><span className="add-action-divider" /><button type="button" className="text-action" onClick={async () => {
              if (module.quiz) { setError('This module already has a quiz.'); return; }
              try { await saveCourseDetailsIfChanged(); await api.put(`/api/manage/modules/${module.id}/quiz`, { title: `${module.title} quiz`, passMark: 70, questions: [] }); await load(); }
              catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Quiz could not be added.'); }
            }} disabled={Boolean(module.quiz)}><CircleHelp size={15} />{module.quiz ? 'Quiz added' : 'Add module quiz'}</button></div>
            {module.quiz && <QuizEditor module={module} onSaved={async () => {
              try { await saveCourseDetailsIfChanged(); await load(); setNotice('Quiz saved.'); }
              catch (cause) { setError(cause instanceof ApiError ? `Quiz saved, but course details could not be saved: ${cause.message}` : 'Quiz saved, but course details could not be saved.'); }
            }} onError={setError} />}
          </div>}
        </div>)}
        {!course.modules?.length && <EmptyState icon={<BookOpen size={22} />} title="Start with a module" detail="Modules organize the video lessons in your course." action={<Button variant="secondary" onClick={() => setAddingModule(true)}><Plus size={16} />Add module</Button>} />}
      </div>
    </section>
    {course.status === 'archived' && <div className="delete-course-row"><div><strong>Delete this course permanently</strong><span>This also removes its uploaded media and cannot be undone.</span></div><Button variant="danger" onClick={async () => {
      if (!window.confirm(`Permanently delete “${course.title}” and its uploaded media?`)) return;
      try { await api.delete(`/api/manage/courses/${course.id}`); navigate('/manage/courses'); }
      catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Course could not be deleted.'); }
    }}><Trash2 size={16} />Delete course</Button></div>}
  </div>;
}

export function CourseAccessPage() {
  const { courseId = '' } = useParams();
  const [course, setCourse] = useState<Course | null>(null);
  const [users, setUsers] = useState<CourseAccessUser[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');

  async function load(search = query) {
    setError('');
    try {
      const [courseResponse, accessResponse] = await Promise.all([fetchCourse(courseId, true), fetchAccess(courseId, search.trim())]);
      setCourse(courseResponse.course); setUsers(accessResponse.users);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Access list could not be loaded.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(''); }, [courseId]);

  async function toggle(user: CourseAccessUser) {
    setSavingId(user.id); setError('');
    try {
      if (user.granted) await api.delete(`/api/manage/courses/${courseId}/access/${user.id}`);
      else await api.put(`/api/manage/courses/${courseId}/access/${user.id}`);
      setUsers((current) => current.map((row) => row.id === user.id ? { ...row, granted: !user.granted } : row));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Access could not be changed.'); }
    finally { setSavingId(''); }
  }

  if (loading) return <div className="page-loading">Loading course access…</div>;
  return <div className="access-page"><div className="breadcrumbs"><Link to="/manage/courses">Courses</Link><span>/</span><Link to={`/manage/courses/${courseId}/edit`}>{course?.title || 'Course'}</Link><span>/</span><span>Manage access</span></div>
    <PageHeading title="Manage access" subtitle={`Control which learners can access ${course?.title || 'this private course'}.`} action={<Link className="button button-secondary" to={`/manage/courses/${courseId}/edit`}><ArrowLeft size={16} />Back to course</Link>} />
    {error && <Notice>{error}</Notice>}
    <form className="access-search" onSubmit={(event) => { event.preventDefault(); load(query); }}><Search size={18} /><input placeholder="Search learners by username" aria-label="Search learners" value={query} onChange={(event) => setQuery(event.target.value)} /><Button variant="secondary" type="submit">Search</Button></form>
    <div className="access-list"><div className="access-list-head"><span>Learner</span><span>Access</span><span>Action</span></div>{users.map((learner) => <div className="access-row" key={learner.id}><div className="access-user"><UserInitial username={learner.username} /><div><strong>{learner.username}</strong>{learner.granted && learner.grantedAt && <small>Granted <DateText value={learner.grantedAt} />{learner.grantedBy ? ` by ${learner.grantedBy}` : ''}</small>}</div></div><span className={learner.granted ? 'access-state access-state-granted' : 'access-state'}>{learner.granted ? 'Has access' : 'No access'}</span><div>{learner.disabled ? <span className="muted">Account disabled</span> : <button className={learner.granted ? 'text-action danger-text' : 'text-action'} disabled={savingId === learner.id} onClick={() => toggle(learner)}>{learner.granted ? 'Revoke access' : 'Grant access'}</button>}</div></div>)}{!users.length && <div className="access-empty">{query ? 'No learners match that search.' : 'Learners who register will appear here.'}</div>}</div>
    <p className="access-footnote"><LockKeyhole size={15} />Private course videos are protected by these access grants. Existing progress stays saved if access is revoked.</p>
  </div>;
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [resetUser, setResetUser] = useState<User | null>(null);
  const resetDialogRef = useRef<HTMLElement | null>(null);
  const resetTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [success, setSuccess] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams(); if (query.trim()) params.set('q', query.trim()); if (roleFilter !== 'all') params.set('role', roleFilter);
      setUsers((await api.get<{ users: User[] }>(`/api/admin/users?${params}`)).users);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Users could not be loaded.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [roleFilter]);

  useEffect(() => {
    if (!resetUser) return;
    const dialog = resetDialogRef.current;
    const previousFocus = resetTriggerRef.current;
    const getFocusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    dialog?.querySelector<HTMLElement>('[autofocus]')?.focus();

    function handleDialogKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setResetUser(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getFocusable();
      if (!focusable.length) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      document.removeEventListener('keydown', handleDialogKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [resetUser]);

  async function updateUser(user: User, changes: { role?: Role; disabled?: boolean }) {
    setSavingId(user.id); setError(''); setSuccess('');
    try {
      const response = await api.patch<{ user: User }>(`/api/admin/users/${user.id}`, changes);
      setUsers((current) => current.map((row) => row.id === user.id ? { ...row, ...response.user } : row));
      setSuccess(`${user.username}'s account was updated.`);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'User could not be updated.'); }
    finally { setSavingId(''); }
  }

  async function resetPassword(event: React.FormEvent) {
    event.preventDefault(); if (!resetUser) return;
    setError(''); setSuccess(''); setSavingId(resetUser.id);
    try {
      await api.put(`/api/admin/users/${resetUser.id}/password`, { password: newPassword, confirmPassword });
      setSuccess(`Password reset for ${resetUser.username}. They will need to sign in again.`);
      setResetUser(null); setNewPassword(''); setConfirmPassword('');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Password could not be reset.'); }
    finally { setSavingId(''); }
  }

  return <div className="management-page users-page"><PageHeading title="Users" subtitle="Manage accounts and assign platform roles." />
    <div className="user-filter-row"><form className="management-search" onSubmit={(event) => { event.preventDefault(); load(); }}><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search users" aria-label="Search users" /><button type="submit">Search</button></form><label className="select-wrap role-filter"><span className="sr-only">Filter by role</span><select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="all">All roles</option><option value="admin">Administrators</option><option value="moderator">Moderators</option><option value="learner">Learners</option></select><ChevronDown size={16} /></label></div>
    {error && <Notice>{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
    {loading ? <div className="page-loading">Loading accounts…</div> : <div className="user-table-wrap"><table className="user-table"><thead><tr><th>User</th><th>Role</th><th>Account</th><th>Created</th><th>Actions</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}>
      <td><span className="owner-cell"><UserInitial username={user.username} /><strong>{user.username}</strong></span></td>
      <td><label className="sr-only" htmlFor={`role-${user.id}`}>Role for {user.username}</label><select id={`role-${user.id}`} value={user.role} disabled={savingId === user.id} onChange={(event) => updateUser(user, { role: event.target.value as Role })}><option value="admin">Administrator</option><option value="moderator">Moderator</option><option value="learner">Learner</option></select></td>
      <td><span className={`account-state ${user.disabled ? 'account-disabled' : 'account-active'}`}><span />{user.disabled ? 'Disabled' : 'Active'}</span></td>
      <td>{user.createdAt ? <DateText value={user.createdAt} /> : '—'}</td>
      <td><div className="user-row-actions"><button className="text-action" onClick={(event) => { resetTriggerRef.current = event.currentTarget; setResetUser(user); }}>Reset password</button><button className={user.disabled ? 'text-action' : 'text-action danger-text'} disabled={savingId === user.id} onClick={() => updateUser(user, { disabled: !user.disabled })}>{user.disabled ? 'Enable' : 'Disable'}</button></div></td>
    </tr>)}</tbody></table>{!users.length && <div className="access-empty">No users match this search.</div>}</div>}
    {resetUser && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setResetUser(null); }}><section ref={resetDialogRef} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-description"><button className="modal-close" type="button" onClick={() => setResetUser(null)} aria-label="Close">×</button><h2 id="reset-title">Reset password</h2><p id="reset-description">Set a temporary password for <strong>{resetUser.username}</strong>. Their active sessions will be signed out.</p><form className="form-stack" onSubmit={resetPassword}><label>New password<input autoFocus required minLength={12} maxLength={256} type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><label>Confirm password<input required minLength={12} maxLength={256} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>{error && <Notice>{error}</Notice>}<Button type="submit" disabled={savingId === resetUser.id}>{savingId === resetUser.id ? 'Saving…' : 'Reset password'}</Button></form></section></div>}
  </div>;
}

export function AdminSettingsPage() {
  const { platformName, platformIcon, themePalette, connectionProtocol, registrationEnabled, userLimit, setBranding, setPlatformAccessSettings } = useAuth();
  const [name, setName] = useState(platformName);
  const [icon, setIcon] = useState<string | null>(platformIcon);
  const [iconEdited, setIconEdited] = useState(false);
  const [palette, setPalette] = useState<BrandingPalette>(themePalette);
  const [protocol, setProtocol] = useState<ConnectionProtocol>(connectionProtocol);
  const [allowRegistration, setAllowRegistration] = useState(registrationEnabled);
  const [userLimitValue, setUserLimitValue] = useState(String(userLimit));
  const [registeredUserCount, setRegisteredUserCount] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setName(platformName); setIcon(platformIcon); setIconEdited(false); setPalette(themePalette); setProtocol(connectionProtocol); setAllowRegistration(registrationEnabled); setUserLimitValue(String(userLimit)); }, [platformName, platformIcon, themePalette, connectionProtocol, registrationEnabled, userLimit]);
  useEffect(() => {
    let active = true;
    api.get<{ registeredUserCount: number }>('/api/admin/settings')
      .then((result) => { if (active) setRegisteredUserCount(result.registeredUserCount); })
      .catch((cause) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Account settings could not be loaded.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.palette = palette;
    return () => { document.documentElement.dataset.palette = themePalette; };
  }, [palette, themePalette]);
  function choosePalette(nextPalette: BrandingPalette) {
    setPalette(nextPalette);
    document.documentElement.dataset.palette = nextPalette;
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setSuccess(''); setSaving(true);
    try {
      const result = await api.put<{ platformName: string; platformIcon: string | null; themePalette: BrandingPalette; connectionProtocol: ConnectionProtocol; registrationEnabled: boolean; registrationAvailable: boolean; userLimit: number; registeredUserCount: number }>('/api/admin/settings', {
        platformName: name,
        themePalette: palette,
        connectionProtocol: protocol,
        registrationEnabled: allowRegistration,
        userLimit: Number(userLimitValue),
        ...(iconEdited ? { platformIcon: icon } : {}),
      });
      setName(result.platformName); setBranding(result.platformName, result.themePalette, result.platformIcon); setPlatformAccessSettings(result.connectionProtocol, result.registrationEnabled, result.registrationAvailable, result.userLimit); setIconEdited(false); setRegisteredUserCount(result.registeredUserCount); setSuccess('Platform settings saved.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Settings could not be saved.'); }
    finally { setSaving(false); }
  }
  return <div className="management-page settings-page"><PageHeading title="Settings" subtitle="Customize platform branding, connection security, and learner registration." />{error && <Notice>{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
    <form className="settings-card form-stack" onSubmit={submit}>
      <div className="settings-card-heading"><span className="settings-icon"><Settings2 size={19} /></span><div><h2>Platform identity</h2><p>Choose the brand learners see throughout the platform.</p></div></div>
      <label>Platform name<input required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <PlatformIconPicker value={icon} onChange={(nextIcon) => { setIcon(nextIcon); setIconEdited(true); }} />
      <div className="branding-choice-field"><span className="branding-choice-label">Color palette</span><small>Preview a palette and save to apply it for everyone.</small><PalettePicker value={palette} onChange={choosePalette} /></div>
      <div className="settings-section-divider"><span>Connection and accounts</span></div>
      <label>Public connection protocol<select value={protocol} onChange={(event) => setProtocol(event.target.value as ConnectionProtocol)}><option value="http">HTTP</option><option value="https">HTTPS</option></select></label>
      <p className="protocol-help">This controls secure session cookies. HTTPS requires a TLS certificate on this server or a reverse proxy. For TLS behind a proxy, set <code>TRUST_PROXY=true</code>.</p>
      <label className="setup-toggle"><span><strong>Allow new registrations</strong><small>Let people create learner accounts from the sign-in page.</small></span><input type="checkbox" checked={allowRegistration} onChange={(event) => setAllowRegistration(event.target.checked)} /></label>
      <label>Maximum registered accounts<input className="user-limit-input" type="number" min={0} max={1000000} step={1} required value={userLimitValue} onChange={(event) => setUserLimitValue(event.target.value)} /><small>0 means no limit. The cap includes administrators, moderators, and learners. Registered accounts: {registeredUserCount ?? 'loading'}.</small></label>
      <div className="settings-card-footer"><span>Database and media paths remain managed through the server environment.</span><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button></div>
    </form>
  </div>;
}

