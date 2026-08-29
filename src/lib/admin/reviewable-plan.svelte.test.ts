import { describe, expect, it } from 'vitest';

import { createReviewablePlan } from './reviewable-plan.svelte';

describe('createReviewablePlan', () => {
	it('only enters review and submits valid plans with the required confirmation', () => {
		let value = $state('');
		const review = createReviewablePlan(() => {
			if (!value) throw new Error('Enter a value.');
			return { value };
		});

		expect(review.startReview()).toBe(false);
		expect(review.prepared.error).toBe('Enter a value.');
		value = 'ready';
		expect(review.startReview()).toBe(true);
		expect(review.state.reviewing).toBe(true);
		expect(review.canSubmit('RUN')).toBe(false);
		review.state.confirmationText = 'RUN';
		expect(review.canSubmit('RUN')).toBe(true);
		review.reset();
		expect(review.state).toEqual({ reviewing: false, confirmationText: '' });
	});
});
