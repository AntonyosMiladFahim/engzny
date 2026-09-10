import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AuthLayout from '../components/auth/AuthLayout';
import AuthCard from '../components/auth/AuthCard';
import Field from '../components/ui/Field';
import PasswordField from '../components/ui/PasswordField';
import Button from '../components/ui/Button';
import FormAlert from '../components/ui/FormAlert';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

function validate({ email, password }) {
    const errors = {};
    if (!email.trim()) errors.email = 'Enter your email address.';
    else if (!EMAIL_RE.test(email.trim())) errors.email = 'That doesn’t look like an email address.';
    if (!password) errors.password = 'Enter your password.';
    return errors;
}

export default function Login() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const from = location.state?.from?.pathname || '/dashboard';

    const [form, setForm] = useState({ email: '', password: '' });
    const [fieldErrors, setFieldErrors] = useState({});
    const [serverError, setServerError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [shakeKey, setShakeKey] = useState(0);

    const onChange = (e) => {
        const { name, value } = e.target;
        setForm((f) => ({ ...f, [name]: value }));
        if (fieldErrors[name]) setFieldErrors((fe) => ({ ...fe, [name]: undefined }));
    };

    const fail = (message) => {
        setServerError(message);
        setShakeKey((k) => k + 1);
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
            await login({ email: form.email.trim(), password: form.password });
            navigate(from, { replace: true });
        } catch (err) {
            fail(err?.message || 'We couldn’t sign you in. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AuthLayout>
            <AuthCard
                eyebrow="Session · 01"
                title="Sign in"
                subtitle="Pick up where your voice notes left off."
                shakeKey={shakeKey}
                footer={
                    <>
                        No account?{' '}
                        <Link
                            to="/register"
                            className="rounded font-bold text-fog-100 underline decoration-signal-400/60 decoration-[1.5px] underline-offset-[5px] transition-colors duration-150 hover:text-signal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/70"
                        >
                            Create one
                        </Link>
                    </>
                }
            >
                <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
                    <FormAlert title="Sign-in failed" message={serverError} onDismiss={() => setServerError('')} />

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
                        autoComplete="current-password"
                        placeholder="••••••••••"
                        value={form.password}
                        onChange={onChange}
                        error={fieldErrors.password}
                        disabled={submitting}
                    />

                    <Button type="submit" loading={submitting} loadingLabel="Signing in…" className="mt-1">
                        Sign in
                    </Button>
                </form>
            </AuthCard>
        </AuthLayout>
    );
}
