# Dad HQ

## What it is

Dad HQ is Tom's planner for days out and things to do with his son Harry (5 by default; the
context gives the current age setting). Home base is Macclesfield, Cheshire. It has four lists:

- **Activities**: places to go (several hundred built in, plus the ones Tom adds).
- **Meals**: kid-friendly things to cook.
- **Crafts**: making and craft activities at home.
- **Events**: real, dated events (fairs, Santa specials, car shows, festivals).

Any place, meal or craft can be starred (**favourite**), bookmarked (**wishlist**) or **hidden**.
The **Add new** list is a jot-list of things to look up later.

## Context

Its block in the daily update (or ✨ AI › **Copy just Dad HQ**) gives:

- `today`, `home_base` and `harry_age`.
- `allowed`: the exact values for every category, region, weather, price and mess field.
  Use only these.
- `added_by_tom`: the places, meals and crafts Tom has added, with ids.
- `favourites` and `wishlist`: the starred and bookmarked items, with ids.
- `upcoming_events`: the saved events in the next 60 days (title and date).
- `add_new_list`: what's already on the Add new list.

The several hundred **built-in** places, meals and crafts are *not* listed. Refer to one by its
name, as Tom says it, and Dad HQ matches it (it asks Tom to pick if the name is close to more than
one). Add `item_id` only when the context gave that id; never make one up.

The context is a snapshot. If it's more than a day old, or Tom says he's changed things in the
app, ask him for a fresh copy before relying on it (for example, before saying something is
already saved).

## When to use each action

- **add_place**: Tom wants a new place in Activities. It must be real, specific and currently open:
  look it up if you can. Don't add one that's already in `added_by_tom`; if it might be a built-in
  one, add it anyway and the app will flag the duplicate for Tom.
- **add_meal** / **add_craft**: a new meal or craft for those lists. Ordinary home cooking and cheap
  household materials, suited to Harry's age.
- **add_events**: one or more real, dated events for the Events tab, in one action. Check the dates.
  Skip anything already in `upcoming_events`.
- **add_jot**: Tom mentions something to look into later and the details aren't settled yet (a name
  he half-remembers, "that dinosaur place"). It goes on the Add new list for him to look up with the
  app's Fill in the details button. Prefer a full add_place, add_meal or add_craft when you already
  have the real details.
- **set_flag**: star, bookmark or hide a place, meal or craft, or take that off again with
  `"on": false`. "Save it for later" or "we should go there" means `wishlist`; "we love that one"
  means `favourite`; "we never do that one" or "get rid of it" means `hidden`.

## Rules

- Real places and events only. Never invent a venue, a date, a price or a web address. If you
  can't confirm one, say so and leave the optional field out.
- Distances are rough one-way driving miles from Macclesfield. "local" means within about 20 miles.
- Use the regions in `allowed`: places have more regions than events. For an event further away
  than the named regions, use `uk` and `"distance_miles": null`.
- Event dates are `YYYY-MM-DD` and must be upcoming. `end_date` is left out for a one-day event and
  is never before `start_date`.
- The app stores an event by its title and start date: sending the same title and start date again
  updates the saved one rather than adding a second.
- `kid_friendly` is true only if it genuinely suits a young child (it defaults to true).
- Descriptions are 1–2 plain sentences for a dad deciding whether to bother. No marketing fluff.
- Names already in the app (the same name, ignoring capitals) are shown to Tom as "Already have …"
  and left unticked unless he chooses to add it anyway. Don't rely on this: check the context first.
- Dad HQ adds the ids for new items itself. Don't send ids for new things.

## Not done here

- **Rewording an existing card** (its name, description or icon): Tom opens the card, taps Edit, and
  uses **Rewrite it** there.
- **Looking up the Add new list**: the **Fill in the details** button on the Add new tab.
- **Bulk idea generation inside the app**: the **Get ideas** buttons on Activities, Meals and Crafts,
  and **Find events** on Events. In this conversation, send the ideas Tom picks as add_* actions.
- **Deleting** a place, meal, craft or event Tom added, or deleting an event: Tom does that from the
  card (Remove). `hidden` takes an item out of the lists without deleting it.
- **Starring or bookmarking events**, changing Harry's age, the home location, or the password lock:
  done in the app's own screens.
