import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  withCredentials: true,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED') window.location.assign('/change-password');
    return Promise.reject(error);
  },
);

export function messageFrom(error) {
  return error?.response?.data?.message || error?.response?.data?.detail || error?.message || 'Something went wrong. Please try again.';
}
