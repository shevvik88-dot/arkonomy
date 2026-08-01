import Stripe from 'npm:stripe@14';

// Statuses that mean "this subscription is actively costing the customer
// money right now" — used consistently wherever we need to answer "does
// this person already have a subscription we shouldn't create a second of".
export const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'];

export interface ActiveSubscriptionMatch {
  customerId: string;
  subscriptionId: string;
  status: string;
}

// Searches ALL Stripe customers matching this email (not just the one
// linked in profiles.stripe_customer_id) for an active/trialing/past_due
// subscription. The DB link can be stale or wrong — that mismatch is
// exactly the bug this exists to catch, so it can't be the only source of
// truth here; Stripe itself has to be asked directly.
export async function findActiveSubscription(
  stripe: Stripe,
  email: string,
): Promise<ActiveSubscriptionMatch | null> {
  const customers = await stripe.customers.list({ email, limit: 10 });
  for (const customer of customers.data) {
    const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'all' });
    const active = subs.data.find(s => ACTIVE_SUBSCRIPTION_STATUSES.includes(s.status));
    if (active) {
      return { customerId: customer.id, subscriptionId: active.id, status: active.status };
    }
  }
  return null;
}
