"""Repository layer: the only code that talks to Supabase.

No other layer imports the Supabase client. Services and the agent layer receive
repository instances through dependency injection and call their methods; every
Supabase error is wrapped into a domain exception before it leaves this package.
"""
