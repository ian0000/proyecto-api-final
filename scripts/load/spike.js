import { thresholds } from './common.js';
export { setup, workload, recovery } from './common.js';
export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      exec: 'workload',
      startVUs: 0,
      stages: [
        { duration: '1s', target: 500 },
        { duration: '1m', target: 500 },
        { duration: '1s', target: 0 },
      ],
      gracefulRampDown: '0s',
      gracefulStop: '0s',
    },
    recovery: {
      executor: 'constant-vus',
      exec: 'recovery',
      startTime: '62s',
      vus: 1,
      duration: '2m',
      gracefulStop: '10s',
    },
  },
  thresholds: { ...thresholds, recovery_tail_errors: ['rate<0.01'] },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
};
