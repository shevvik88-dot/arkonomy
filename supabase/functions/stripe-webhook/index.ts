import Stripe from 'npm:stripe@14';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const STRIPE_SECRET_KEY    = Deno.env.get('STRIPE_SECRET_KEY');
  const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET');

  if (!STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'STRIPE_SECRET_KEY not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const body = await req.text();
  let event: Stripe.Event;

  if (STRIPE_WEBHOOK_SECRET) {
    const sig = req.headers.get('stripe-signature');
    if (!sig) {
      return new Response('Missing stripe-signature', { status: 400 });
    }
    try {
      event = await stripe.webhooks.constructEventAsync(body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return new Response(`Webhook Error: ${String(err)}`, { status: 400 });
    }
  } else {
    // No webhook secret configured — parse without verification (dev mode)
    event = JSON.parse(body) as Stripe.Event;
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId  = session.client_reference_id;
      const customerId = session.customer as string;

      if (userId) {
        const { error } = await supabase
          .from('profiles')
          .update({ plan: 'pro', stripe_customer_id: customerId })
          .eq('id', userId);

        if (error) console.error('Failed to update profile to pro:', error);
        else console.log(`User ${userId} upgraded to pro, customer: ${customerId}`);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = sub.customer as string;

      const { error } = await supabase
        .from('profiles')
        .update({ plan: 'free' })
        .eq('stripe_customer_id', customerId);

      if (error) console.error('Failed to downgrade profile:', error);
      else console.log(`Customer ${customerId} downgraded to free`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('stripe-webhook handler error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
