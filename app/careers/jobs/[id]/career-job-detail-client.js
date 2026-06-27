'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BriefcaseBusiness, Building2, MapPin } from 'lucide-react';
import { useToast } from '@/app/components/toast-provider';
import { formatPhoneInput } from '@/lib/phone';
import { isValidOptionalHttpUrl } from '@/lib/url-validation';
import {
	RESUME_UPLOAD_MAX_BYTES,
	isAllowedResumeUploadFileName,
	resumeUploadAcceptString
} from '@/lib/candidate-attachment-options';

const initialForm = {
	firstName: '',
	lastName: '',
	email: '',
	mobile: '',
	linkedinUrl: '',
	faxNumber: ''
};

const CAREER_APPLY_SESSION_KEY = 'careerQuickApplyForm';

function toStoredFormValue(value) {
	return {
		linkedinUrl: String(value?.linkedinUrl || '')
	};
}

function loadStoredApplyForm() {
	if (typeof window === 'undefined') {
		return initialForm;
	}

	try {
		const raw = window.sessionStorage.getItem(CAREER_APPLY_SESSION_KEY);
		if (!raw) return initialForm;
		return {
			...initialForm,
			...toStoredFormValue(JSON.parse(raw))
		};
	} catch {
		return initialForm;
	}
}

export default function CareerJobDetailClient({ job }) {
	const toast = useToast();
	const [form, setForm] = useState(loadStoredApplyForm);
	const [startedAtMs, setStartedAtMs] = useState(() => String(Date.now()));
	const [resumeFile, setResumeFile] = useState(null);
	const [resumeInputKey, setResumeInputKey] = useState(0);
	const [submitState, setSubmitState] = useState({ submitting: false });
	const [answers, setAnswers] = useState({});
	const hasValidLinkedinUrl = isValidOptionalHttpUrl(form.linkedinUrl);

	const questions = Array.isArray(job.applicationQuestions) ? job.applicationQuestions : [];

	const requiredQuestionsAnswered = useMemo(
		() => questions.filter((q) => q.required).every((q) => String(answers[q.id] || '').trim()),
		[questions, answers]
	);

	const canSubmit = useMemo(
		() =>
			Boolean(
				form.firstName.trim() &&
					form.lastName.trim() &&
					form.email.trim() &&
					form.mobile.trim() &&
					resumeFile &&
					requiredQuestionsAnswered
			),
		[form, resumeFile, requiredQuestionsAnswered]
	);

	useEffect(() => {
		if (typeof window === 'undefined') return;
		try {
			window.sessionStorage.setItem(
				CAREER_APPLY_SESSION_KEY,
				JSON.stringify(toStoredFormValue(form))
			);
		} catch {
			// Ignore sessionStorage failures and keep the form usable.
		}
	}, [form.linkedinUrl]);

	async function onSubmit(event) {
		event.preventDefault();
		if (submitState.submitting) return;
		if (!canSubmit) {
			toast.error('Complete all required fields and upload your resume before submitting.');
			return;
		}
		if (!requiredQuestionsAnswered) {
			toast.error('Please answer all required application questions before submitting.');
			return;
		}
		if (form.linkedinUrl.trim() && !hasValidLinkedinUrl) {
			toast.error('Enter a valid LinkedIn URL, including http:// or https://.');
			return;
		}
		if (!resumeFile || !isAllowedResumeUploadFileName(resumeFile.name || '')) {
			toast.error('Unsupported resume file type. Use PDF, DOC, or DOCX.');
			return;
		}
		if (resumeFile.size > RESUME_UPLOAD_MAX_BYTES) {
			toast.error(`Resume exceeds ${Math.floor(RESUME_UPLOAD_MAX_BYTES / (1024 * 1024))} MB limit.`);
			return;
		}

		setSubmitState({ submitting: true });
		try {
			const payload = new FormData();
			payload.set('firstName', form.firstName);
			payload.set('lastName', form.lastName);
			payload.set('email', form.email);
			payload.set('mobile', form.mobile);
			payload.set('linkedinUrl', form.linkedinUrl);
			payload.set('faxNumber', form.faxNumber);
			payload.set('startedAtMs', startedAtMs);
			payload.set(
				'applicationAnswers',
				JSON.stringify(
					questions.map((q) => ({ questionId: q.id, answer: String(answers[q.id] || '') }))
				)
			);
			payload.set('resumeFile', resumeFile);

			const res = await fetch(`/api/careers/jobs/${job.id}/apply`, {
				method: 'POST',
				body: payload
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				toast.error(data.error || 'Application could not be submitted. Please try again.');
				setSubmitState({ submitting: false });
				return;
			}

			toast.success(data.message || 'Application submitted successfully.');
			setSubmitState({ submitting: false });
			setStartedAtMs(String(Date.now()));
			setResumeFile(null);
			setResumeInputKey((current) => current + 1);
			setForm((current) => ({ ...current, faxNumber: '' }));
		} catch {
			toast.error('Application could not be submitted. Please try again.');
			setSubmitState({ submitting: false });
		}
	}

	return (
		<section className="career-detail-page">
			<header className="career-detail-top">
				<Link href="/careers" className="career-back-link">
					<ArrowLeft aria-hidden="true" />
					<span>Back to open roles</span>
				</Link>
			</header>

			<div className="career-detail-layout">
				<article className="career-detail-main">
					<div className="career-detail-hero">
						<p className="careers-eyebrow">Now hiring</p>
						<h1>{job.title}</h1>
						<div className="career-detail-meta">
							<p>
								<Building2 aria-hidden="true" />
								<span>{job.client?.name || 'Confidential Client'}</span>
							</p>
							<p>
								<MapPin aria-hidden="true" />
								<span>{job.location || 'Location flexible'}</span>
							</p>
							<p>
								<BriefcaseBusiness aria-hidden="true" />
								<span>{job.employmentType || 'Role type to be discussed'}</span>
							</p>
						</div>
					</div>

					<div
						className="career-detail-description"
						dangerouslySetInnerHTML={{
							__html:
								job.publicDescription ||
								'<p>Full role details are available during the interview process.</p>'
						}}
					/>
				</article>

				<aside className="career-apply-card">
					<h2>Quick Apply</h2>
					<p>Submit your profile and we will connect with you if your background aligns.</p>
					<form onSubmit={onSubmit} className="career-apply-form">
						<p className="career-apply-helper">
							Your contact details stay in this browser session so you can apply to multiple roles faster.
						</p>
						<div className="career-apply-grid-2">
							<label>
								<span>First Name *</span>
								<input
									value={form.firstName}
									onChange={(event) =>
										setForm((current) => ({ ...current, firstName: event.target.value }))
									}
									required
								/>
							</label>
							<label>
								<span>Last Name *</span>
								<input
									value={form.lastName}
									onChange={(event) =>
										setForm((current) => ({ ...current, lastName: event.target.value }))
									}
									required
								/>
							</label>
						</div>

						<label>
							<span>Email *</span>
							<input
								type="email"
								value={form.email}
								onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
								required
							/>
						</label>

						<div className="career-apply-grid-2">
							<label>
								<span>Mobile *</span>
								<input
									type="tel"
									inputMode="numeric"
									autoComplete="tel"
									value={form.mobile}
									onChange={(event) =>
										setForm((current) => ({
											...current,
											mobile: formatPhoneInput(event.target.value)
										}))
									}
									required
								/>
							</label>
						</div>

						<label>
							<span>LinkedIn URL</span>
							<input
								type="url"
								value={form.linkedinUrl}
								onChange={(event) => setForm((current) => ({ ...current, linkedinUrl: event.target.value }))}
							/>
						</label>

						{questions.length > 0 ? (
							<div className="career-apply-questions">
								{questions.map((q) => (
									<label key={q.id}>
										<span>
											{q.label}
											{q.required ? ' *' : ''}
										</span>
										<textarea
											rows={3}
											value={answers[q.id] || ''}
											onChange={(e) =>
												setAnswers((current) => ({ ...current, [q.id]: e.target.value }))
											}
											required={q.required}
										/>
									</label>
								))}
							</div>
						) : null}

						<label>
							<span>Resume File (PDF, DOC, DOCX) *</span>
							<input
								key={resumeInputKey}
								type="file"
								accept={resumeUploadAcceptString()}
								required
								onChange={(event) => {
									const file = event.target.files?.[0] || null;
									if (file && !isAllowedResumeUploadFileName(file.name || '')) {
										toast.error('Unsupported resume file type. Use PDF, DOC, or DOCX.');
										setResumeFile(null);
										setResumeInputKey((current) => current + 1);
										return;
									}
									if (file && file.size > RESUME_UPLOAD_MAX_BYTES) {
										toast.error(`Resume exceeds ${Math.floor(RESUME_UPLOAD_MAX_BYTES / (1024 * 1024))} MB limit.`);
										setResumeFile(null);
										setResumeInputKey((current) => current + 1);
										return;
									}
									setResumeFile(file);
								}}
							/>
						</label>
						{resumeFile ? <p className="career-apply-file-name">Selected: {resumeFile.name}</p> : null}
						<label className="career-honeypot-field" aria-hidden="true">
							<span>Fax Number</span>
							<input
								tabIndex={-1}
								autoComplete="off"
								value={form.faxNumber}
								onChange={(event) =>
									setForm((current) => ({ ...current, faxNumber: event.target.value }))
								}
							/>
						</label>
						<input type="hidden" name="startedAtMs" value={startedAtMs} readOnly />

						<button type="submit" disabled={!canSubmit || submitState.submitting}>
							{submitState.submitting ? 'Submitting...' : 'Submit Application'}
						</button>
					</form>
				</aside>
			</div>
		</section>
	);
}
