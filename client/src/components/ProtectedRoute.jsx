import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, homeFor } from '../context/AuthContext';

export default function ProtectedRoute({ roles, children }) {
  const { user, role } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (roles && !roles.includes(role)) return <Navigate to={homeFor(role)} replace />;
  return children;
}
