import { create } from 'zustand'

interface AuthState {
  token: string | null
  regionId: string | null
  userName: string | null
  phone: string | null
  setAuth: (token: string, regionId: string, userName: string, phone: string) => void
  setRegion: (regionId: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('qv_token'),
  regionId: localStorage.getItem('qv_region'),
  userName: localStorage.getItem('qv_user'),
  phone: localStorage.getItem('qv_phone'),

  setAuth: (token, regionId, userName, phone) => {
    localStorage.setItem('qv_token', token)
    localStorage.setItem('qv_region', regionId)
    localStorage.setItem('qv_user', userName)
    localStorage.setItem('qv_phone', phone)
    set({ token, regionId, userName, phone })
  },

  setRegion: (regionId) => {
    localStorage.setItem('qv_region', regionId)
    set({ regionId })
  },

  logout: () => {
    localStorage.removeItem('qv_token')
    localStorage.removeItem('qv_region')
    localStorage.removeItem('qv_user')
    localStorage.removeItem('qv_phone')
    set({ token: null, regionId: null, userName: null, phone: null })
  },
}))
