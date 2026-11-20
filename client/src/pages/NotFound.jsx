import { Link } from 'react-router-dom';
import { FiMapPin } from 'react-icons/fi';
import { Empty } from '../components/ui';

export default function NotFound() {
  return (
    <div className="container page">
      <Empty icon={FiMapPin} title="This page took a wrong turn" action={<Link className="btn" to="/">Search trips</Link>}>
        The address you opened does not exist.
      </Empty>
    </div>
  );
}
