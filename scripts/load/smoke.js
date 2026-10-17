import { sleep } from 'k6';
import { workload } from './common.js';
export { setup } from './common.js';
export const options = {
  scenarios: { smoke: { executor: 'constant-vus', vus: 5, duration: '20s', gracefulStop: '10s' } },
  thresholds: {
    successful_business_latency_ms: ['p(95)<2000'],
    errors_including_429: ['rate<0.01'],
    unexpected_errors: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'p(90)', 'p(95)', 'p(99)'],
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
};
export default function smoke(data) {
  workload(data);
  // About 60 business requests in 20s: below the normal 120/min identity quota.
  sleep(4);
}
