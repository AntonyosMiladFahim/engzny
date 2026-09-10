import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AuthLayout from '../components/auth/AuthLayout';
import AuthCard from '../components/auth/AuthCard';
import Field from '../components/ui/Field';
import PasswordField from '../components/ui/PasswordField';
import Button from '../components/ui/Button';
import FormAlert from '../components/ui/FormAlert';

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const MIN_PASSWORD = 8;

function validate({ name, email, password }) {
    const errors = {};
    if (!name.trim()) errors.name = 'Tell us what to call you.';
    else if (name.trim().length < 2) errors.name = 'Use at least two characters.';
    if (!email.trim()) errors.email = 'Enter your email address.';
    else if (!EMAIL_RE.test(email.trim())) errors.email = 'That doesn’t look like an email address.';
    if (!password) errors.password = 'Choose a password.';
    else if (password.length < MIN_PASSWORD) errors.password = `Use at least ${MIN_PASSWORD} characters.`;
    return errors;
}

export default function Register() {
    const { register } = useAuth();
    const navigate = useNavigate();

    const [form, setForm] = useState({ name: '', email: '', password: '' });
    const [fieldErrors, setFieldErrors] = useState({});
    const [serverError, setServerError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [shakeKey, setShakeKey] = useState(0);

    const onChange = (e) => {
        const { name, value } = e.target;
        setForm((f) => ({ ...f, [name]: value }));
        if (fieldErrors[name]) setFieldErrors((fe) => ({ ...fe, [name]: undefined }));
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        setServerError('');

        const errors = validate(form);
        if (Object.keys(errors).length) {
            setFieldErrors(errors);
            setShakeKey((k) => k + 1);
            document.getElementById(Object.keys(errors)[0])?.focus();
            return;
        }

        setSubmitting(true);
        try {
            await register({ name: form.name.trim(), email: form.email.trim(), password: form.password });
            navigate('/dashboard', { replace: true });
        } catch (err) {
            setServerError(err?.message || 'We couldn’t create your account. Please try again.');
            setShakeKey((k) => k + 1);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AuthLayout>
            <AuthCard
                eyebrow="Session · 00"
                title="Create account"
                subtitle="Thirty seconds. No card. Cancel by closing the tab."
                shakeKey={shakeKey}
                footer={
                    <>
                        Already registered?{' '}
                        <Link
                            to="/login"
                            className="rounded font-bold text-fog-100 underline decoration-signal-400/60 decoration-[1.5px] underline-offset-[5px] transition-colors duration-150 hover:text-signal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/70"
                        >
                            Sign in
                        </Link>
                    </>
                }
            >
                <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
                    <FormAlert
                        title="Couldn’t create your account"
                        message={serverError}
                        onDismiss={() => setServerError('')}
                    />

                    <Field
                        id="name"
                        name="name"
                        label="Name"
                        icon={User}
                        autoComplete="name"
                        autoCapitalize="words"
                        placeholder="Ada Lovelace"
                        value={form.name}
                        onChange={onChange}
                        error={fieldErrors.name}
                        disabled={submitting}
                    />

                    <Field
                        id="email"
                        name="email"
                        label="Email"
                        icon={Mail}
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="you@company.com"
                        value={form.email}
                        onChange={onChange}
                        error={fieldErrors.email}
                        disabled={submitting}
                    />

                    <PasswordField
                        id="password"
                        name="password"
                        label="Password"
                        hint={`${MIN_PASSWORD}+ characters`}
                        autoComplete="new-password"
                        placeholder="••••••••••"
                        value={form.password}
                        onChange={onChange}
                        error={fieldErrors.password}
                        disabled={submitting}
                        showMeter
                    />

                    <Button type="submit" loading={submitting} loadingLabel="Creating…" className="mt-1">
                        Create account
                    </Button>

                    <p className="text-center text-[12.5px] leading-relaxed text-fog-500">
                        By continuing you agree to the{' '}
                        <a href="#terms" className="underline decoration-white/20 underline-offset-[3px] hover:text-fog-300">
                            terms
                        </a>{' '}
                        and{' '}
                        <a href="#privacy" className="underline decoration-white/20 underline-offset-[3px] hover:text-fog-300">
                            privacy policy
                        </a>
                        .
                    </p>
                </form>
            </AuthCard>
        </AuthLayout>
    );
}
