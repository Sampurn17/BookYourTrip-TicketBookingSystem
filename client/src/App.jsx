import { Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import AgentChat from './components/AgentChat';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import SearchResults from './pages/SearchResults';
import Checkout from './pages/Checkout';
import MyTrips from './pages/MyTrips';
import Profile from './pages/Profile';
import ProviderDashboard from './pages/provider/ProviderDashboard';
import ProviderTrips from './pages/provider/ProviderTrips';
import Manifest from './pages/provider/Manifest';
import AdminDashboard from './pages/admin/AdminDashboard';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <>
      <Navbar />
      <main>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/search" element={<SearchResults />} />
          <Route
            path="/book/:tripId"
            element={
              <ProtectedRoute roles={['customer']}>
                <Checkout />
              </ProtectedRoute>
            }
          />
          <Route
            path="/trips"
            element={
              <ProtectedRoute roles={['customer']}>
                <MyTrips />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/provider"
            element={
              <ProtectedRoute roles={['provider']}>
                <ProviderDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/provider/trips"
            element={
              <ProtectedRoute roles={['provider']}>
                <ProviderTrips />
              </ProtectedRoute>
            }
          />
          <Route
            path="/provider/trips/:id/manifest"
            element={
              <ProtectedRoute roles={['provider']}>
                <Manifest />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <AgentChat />
    </>
  );
}
