import React, { useState } from 'react';

export default function App() {
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const testConnection = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/calculate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ num1: 3, num2: 5 })
            });
            const data = await response.json();
            if (response.ok) {
                setResult(data);
            } else {
                setError(data.error || 'Something went wrong');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ textAlign: 'center', marginTop: '50px', fontFamily: 'sans-serif' }}>
            <h1>🎙️ WhatsApp Voice Summarizer Frontend is Live!</h1>
            <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #ccc', display: 'inline-block', borderRadius: '8px' }}>
                <h2>Test Backend Connection</h2>
                <p>Click the button to send 1 + 1 to the backend.</p>
                <button 
                    onClick={testConnection} 
                    disabled={loading}
                    style={{ padding: '10px 20px', fontSize: '16px', cursor: 'pointer' }}
                >
                    {loading ? 'Sending...' : 'Test 1 + 1'}
                </button>
                {result && (
                    <div style={{ marginTop: '20px', color: 'green' }}>
                        <p><strong>Success!</strong></p>
                        <p>{result.message}</p>
                    </div>
                )}
                {error && (
                    <div style={{ marginTop: '20px', color: 'red' }}>
                        <p><strong>Error:</strong> {error}</p>
                    </div>
                )}
            </div>
        </div>
    );
}