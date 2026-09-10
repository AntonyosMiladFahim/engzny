import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { 
  Smartphone, 
  Loader2, 
  Copy, 
  CheckCircle2, 
  ArrowRight, 
  Check, 
  AlertCircle 
} from 'lucide-react';

const COUNTRY_CODES = [
  { code: '+20', country: 'Egypt' },
  { code: '+1', country: 'USA/Canada' },
  { code: '+44', country: 'UK' },
  { code: '+91', country: 'India' },
  { code: '+971', country: 'UAE' },
  { code: '+966', country: 'Saudi Arabia' },
];

export default function WhatsAppLinkWizard({ onComplete }) {
  const [step, setStep] = useState(1); // 1: Input, 2: Loading, 3: Code, 4: Success
  const [countryCode, setCountryCode] = useState('+20');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  // Handle phone number input
  const handlePhoneChange = (e) => {
    // Only allow numbers
    const val = e.target.value.replace(/\D/g, '');
    setPhoneNumber(val);
    setError(null);
  };

  // Generate pairing code
  const handleGenerateCode = async () => {
    if (!phoneNumber) return;
    
    setStep(2);
    setError(null);

    // Format phone number for WAHA (strip +, spaces)
    const formattedPhone = `${countryCode.replace('+', '')}${phoneNumber}`;

    try {
      const response = await axios.post('/api/whatsapp/link-device', {
        phoneNumber: formattedPhone
      });

      const rawCode = response.data.pairingCode || '';
      // Format as ABCD-1234 if 8 chars
      const formattedCode = rawCode.length === 8 
        ? `${rawCode.slice(0, 4)}-${rawCode.slice(4)}`
        : rawCode;

      setPairingCode(formattedCode);
      setStep(3);
    } catch (err) {
      console.error('Failed to generate code:', err);
      if (err.response?.status === 429) {
        setError('Please wait a moment before requesting another code.');
      } else {
        setError(err.response?.data?.message || 'Failed to generate code. Please try again.');
      }
      setStep(1); // Go back to input if it fails
    }
  };

  // Polling for success status when on step 3
  useEffect(() => {
    let interval;
    if (step === 3) {
      interval = setInterval(async () => {
        try {
          const res = await axios.get('/api/whatsapp/status');
          if (res.data?.connected) {
            setStep(4);
            clearInterval(interval);
          }
        } catch (err) {
          console.error('Polling error:', err);
          // Optional: handle polling error (maybe don't interrupt user unless fatal)
        }
      }, 3000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [step]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(pairingCode.replace('-', ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Animation variants
  const slideVariants = {
    initial: { opacity: 0, x: 20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -20 },
  };

  return (
    <div className="w-full max-w-md mx-auto bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100 p-8">
      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div
            key="step1"
            variants={slideVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.3 }}
            className="flex flex-col space-y-6"
          >
            <div className="text-center">
              <div className="mx-auto bg-green-50 w-16 h-16 rounded-full flex items-center justify-center mb-4">
                <Smartphone className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Link WhatsApp</h2>
              <p className="text-gray-500 mt-2 text-sm">
                Enter your WhatsApp phone number to get a secure pairing code.
              </p>
            </div>

            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-start">
                <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}

            <div className="flex space-x-2">
              <div className="w-1/3">
                <label className="block text-xs font-medium text-gray-700 mb-1">Country</label>
                <select 
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-3 text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                >
                  {COUNTRY_CODES.map(c => (
                    <option key={c.code} value={c.code}>
                      {c.code} ({c.country})
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-2/3">
                <label className="block text-xs font-medium text-gray-700 mb-1">Phone Number</label>
                <input 
                  type="tel"
                  placeholder="1012345678"
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                  value={phoneNumber}
                  onChange={handlePhoneChange}
                />
              </div>
            </div>

            <button
              onClick={handleGenerateCode}
              disabled={!phoneNumber || phoneNumber.length < 5}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Generate Pairing Code
              <ArrowRight className="w-5 h-5 ml-2" />
            </button>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div
            key="step2"
            variants={slideVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center justify-center py-12 space-y-6 text-center"
          >
            <div className="relative w-20 h-20">
              <div className="absolute inset-0 border-4 border-green-100 rounded-full"></div>
              <motion.div 
                className="absolute inset-0 border-4 border-green-500 rounded-full border-t-transparent"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
              </div>
            </div>
            <div>
              <h3 className="text-xl font-semibold text-gray-900">Generating Code</h3>
              <p className="text-gray-500 mt-2 text-sm max-w-xs mx-auto">
                Generating your secure WhatsApp pairing code...
              </p>
            </div>
          </motion.div>
        )}

        {step === 3 && (
          <motion.div
            key="step3"
            variants={slideVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.3 }}
            className="flex flex-col space-y-8"
          >
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900">Your Pairing Code</h2>
              <p className="text-gray-500 mt-2 text-sm">
                Enter this code on your phone to link your account.
              </p>
            </div>

            <div className="bg-gray-50 rounded-xl p-6 border border-gray-200 flex flex-col items-center justify-center relative group">
              <span className="text-4xl font-mono font-bold tracking-widest text-gray-900">
                {pairingCode || '....-....'}
              </span>
              
              <button 
                onClick={copyToClipboard}
                className="mt-4 flex items-center text-sm font-medium text-gray-500 hover:text-green-600 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 mr-1.5 text-green-600" />
                    <span className="text-green-600">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-1.5" />
                    Copy to Clipboard
                  </>
                )}
              </button>
            </div>

            <div className="bg-blue-50/50 rounded-xl p-5 border border-blue-100">
              <h4 className="font-semibold text-gray-900 mb-3 text-sm">How to link:</h4>
              <ol className="space-y-3">
                <li className="flex text-sm text-gray-600">
                  <span className="bg-blue-100 text-blue-700 w-5 h-5 rounded-full flex items-center justify-center font-bold text-xs mr-3 flex-shrink-0 mt-0.5">1</span>
                  <span>Open Whats on your phone.</span>
                </li>
                <li className="flex text-sm text-gray-600">
                  <span className="bg-blue-100 text-blue-700 w-5 h-5 rounded-full flex items-center justify-center font-bold text-xs mr-3 flex-shrink-0 mt-0.5">2</span>
                  <span>Tap the three dots (or Settings) &gt; Linked Devices &gt; <strong>Link a Device</strong>.</span>
                </li>
                <li className="flex text-sm text-gray-600">
                  <span className="bg-blue-100 text-blue-700 w-5 h-5 rounded-full flex items-center justify-center font-bold text-xs mr-3 flex-shrink-0 mt-0.5">3</span>
                  <span>Tap <strong>"Link with phone number instead"</strong> and enter the code above.</span>
                </li>
              </ol>
            </div>

            <div className="flex items-center justify-center space-x-2 text-sm text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Waiting for connection...</span>
            </div>

            {error && (
              <div className="text-center mt-2">
                <button 
                  onClick={() => setStep(1)}
                  className="text-sm font-medium text-red-500 hover:text-red-700 underline"
                >
                  Try Again
                </button>
              </div>
            )}
          </motion.div>
        )}

        {step === 4 && (
          <motion.div
            key="step4"
            variants={slideVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center justify-center py-8 space-y-6 text-center"
          >
            <motion.div 
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.2 }}
              className="bg-green-100 w-24 h-24 rounded-full flex items-center justify-center"
            >
              <motion.div
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.5, delay: 0.4 }}
              >
                <CheckCircle2 className="w-14 h-14 text-green-600" />
              </motion.div>
            </motion.div>
            
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Successfully Linked!</h2>
              <p className="text-gray-500 mt-2 text-sm max-w-sm">
                Your WhatsApp account has been successfully connected to the platform.
              </p>
            </div>

            <button
              onClick={() => onComplete && onComplete()}
              className="w-full bg-gray-900 hover:bg-gray-800 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center transition-colors mt-4"
            >
              Go to Dashboard
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
