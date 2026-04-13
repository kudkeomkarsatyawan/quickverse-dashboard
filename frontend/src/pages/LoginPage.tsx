import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../lib/store'
import { sendOtp, verifyOtp, fetchRegions, syncOrders, syncVendors } from '../lib/api'

interface Region {
  regionId: string
  regionName: string
  displayName: string
  regionEnabled: boolean
}

type Step = 'phone' | 'otp' | 'region'

export default function LoginPage() {
  const navigate = useNavigate()
  const { setAuth, setRegion } = useAuthStore()

  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [verificationId, setVerificationId] = useState('')
  const [token, setToken] = useState('')
  const [regions, setRegions] = useState<Region[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Apply dark class based on saved preference
  useEffect(() => {
    const dark = localStorage.getItem('qv_theme') === 'dark'
    document.documentElement.classList.toggle('dark', dark)
  }, [])

  const handleSendOtp = async () => {
    if (phone.length < 10) { setError('Enter a valid phone number'); return }
    setLoading(true); setError('')
    try {
      const result = await sendOtp(phone)
      setVerificationId(result.verificationId)
      setStep('otp')
    } catch (e: any) { setError(e.response?.data?.detail || 'Failed to send OTP') }
    finally { setLoading(false) }
  }

  const handleVerifyOtp = async () => {
    if (otp.length < 4) { setError('Enter valid OTP'); return }
    setLoading(true); setError('')
    try {
      const result = await verifyOtp(phone, otp, verificationId)
      setToken(result.token)
      try { const r = await fetchRegions(); setRegions(r); setStep('region') }
      catch { setError('Login successful but failed to load regions.'); setStep('region') }
    } catch (e: any) { setError(e.response?.data?.detail || 'OTP verification failed') }
    finally { setLoading(false) }
  }

  const handleSelectRegion = async (regionId: string) => {
    setAuth(token, regionId, '', phone)
    setRegion(regionId)
    setLoading(true)
    try { await syncVendors(regionId); await syncOrders(regionId, token) } catch {}
    setLoading(false)
    navigate('/')
  }

  const steps = ['phone', 'otp', 'region'] as const
  const stepIndex = steps.indexOf(step)

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-ink tracking-tight">Quickverse</h1>
          <p className="text-sm text-ink-tertiary mt-1">Sign in to your dashboard</p>
        </div>

        <div className="qv-card p-6">
          {/* Step indicator */}
          <div className="flex items-center justify-center gap-1.5 mb-6">
            {steps.map((_, i) => (
              <div key={i} className={`h-1 rounded-full transition-all ${
                i <= stepIndex ? 'w-8 bg-accent' : 'w-4 bg-line'
              }`} />
            ))}
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {step === 'phone' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1.5">Phone number</label>
                <div className="flex gap-2">
                  <span className="inline-flex items-center px-3 bg-inset border border-line rounded-lg text-sm text-ink-tertiary">+91</span>
                  <input
                    type="tel" value={phone}
                    onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="Enter your number"
                    className="flex-1 qv-input" maxLength={10}
                    onKeyDown={e => e.key === 'Enter' && handleSendOtp()}
                  />
                </div>
              </div>
              <button onClick={handleSendOtp} disabled={loading} className="w-full qv-btn py-2.5">
                {loading ? 'Sending...' : 'Send OTP'}
              </button>
            </div>
          )}

          {step === 'otp' && (
            <div className="space-y-4">
              <p className="text-sm text-ink-secondary text-center">Code sent to +91 {phone}</p>
              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1.5">Verification code</label>
                <input
                  type="text" value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Enter OTP"
                  className="w-full qv-input text-center text-lg tracking-[0.3em] font-mono"
                  maxLength={6}
                  onKeyDown={e => e.key === 'Enter' && handleVerifyOtp()}
                  autoFocus
                />
              </div>
              <button onClick={handleVerifyOtp} disabled={loading} className="w-full qv-btn py-2.5">
                {loading ? 'Verifying...' : 'Verify'}
              </button>
              <button onClick={() => { setStep('phone'); setOtp('') }}
                className="w-full text-sm text-ink-tertiary hover:text-ink-secondary transition-colors">
                Use a different number
              </button>
            </div>
          )}

          {step === 'region' && (
            <div className="space-y-4">
              <p className="text-sm text-ink-secondary text-center">Select your region</p>
              {loading && <p className="text-sm text-accent text-center">Syncing data...</p>}
              {regions.length > 0 ? (
                <div className="space-y-1.5 max-h-60 overflow-auto">
                  {regions.filter(r => r.regionEnabled !== false).map(r => (
                    <button key={r.regionId} onClick={() => handleSelectRegion(r.regionId)}
                      disabled={loading}
                      className="w-full text-left p-3.5 bg-inset border border-line rounded-lg hover:border-accent hover:bg-accent-soft transition-all disabled:opacity-40 group"
                    >
                      <p className="text-sm font-medium text-ink">{r.displayName || r.regionName}</p>
                      <p className="text-2xs text-ink-tertiary mt-0.5 font-mono">{r.regionId}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-ink-secondary mb-1.5">Region ID</label>
                  <input type="text" placeholder="e.g. BEED-431122" className="w-full qv-input"
                    onKeyDown={e => { if (e.key === 'Enter') handleSelectRegion((e.target as HTMLInputElement).value) }} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
