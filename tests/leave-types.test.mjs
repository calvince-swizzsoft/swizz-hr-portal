import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueLeaveTypes } from '../src/lib/leaveTypes.js';

test('duplicate names prefer canonical mirror IDs and keep capitalized Annual leave', () => {
  const types = uniqueLeaveTypes([
    { Id: 'duplicate-annual', Description: 'annual leave' },
    { Id: 'other-compassionate', Description: 'Compassionate leave' },
    { Id: '24000000-0000-4000-8000-000000000001', Description: 'compassionate leave' },
    { Id: '20000000-0000-4000-8000-000000000001', Description: 'Annual leave' },
    { Id: '24000000-0000-4000-8000-000000000002', Description: 'maternity leave' },
    { Id: '24000000-0000-4000-8000-000000000003', Description: 'paternity leave' },
    { Id: 'duplicate-maternity', Description: 'Maternity Leave' },
  ]);

  assert.deepEqual(types.map(type => type.Description), [
    'Annual leave',
    'compassionate leave',
    'maternity leave',
    'paternity leave',
  ]);
  assert.equal(types.find(type => type.Description === 'compassionate leave').Id,
    '24000000-0000-4000-8000-000000000001');
});

test('malformed leave type rows are excluded without changing valid rows', () => {
  assert.deepEqual(uniqueLeaveTypes([
    null,
    { Id: 'missing-name' },
    { Description: 'missing-id' },
    { Id: 'valid', Description: 'Sick leave' },
  ]), [{ Id: 'valid', Description: 'Sick leave' }]);
});
