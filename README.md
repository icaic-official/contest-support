# minsky -- ICAIC Contest Observability Dashboard

# Plan

## Problem
During past contests, when contestants face a technical problem, they usually raise a card to get the attention of an on-site competition volunteer. The volunteer will come and assist the contestant, while also: noting down the time taken to address and resolve the problem, taking down photos of the problems faced, and describing the problem.

If the volunteer cannot solve the problem, the volunteer escalates to a secondary team -- e.g., the scientific committee or the campus network administrator. 
The entire process of this for past contests was very hectic, as the duration of a contest can generate upwards of 600 issues surfaced by contestants. 
While attempts were made to make this easier, such as submitting a Google form and then noting the problem down in a Google spreadsheet, a better solution needs to be proposed.

## Proposed Solution
When an issue is surfaced, a timer will be started that records down how long a contestant's issue gets triaged and resolved. 
The contestant jury / scientific committee will then make a recommendation, based on the time taken and type of problem faced, to give a discretionary time extension using the dashboard. 

The solution should be a live dashboard that handles the triage of contestants' technical issues and the dispatch of volunteers to the contestant. 

It should be modular in that volunteers have different roles, e.g., a volunteer can hold a single role or multiple roles.
- Helpers will be able to log into their accounts during the contestant, and depending on their roles, perform certain tasks in relation to solving their problem / triaging. 
- Helpers can also include members of the scientific committee.  
- Roles should be readily modifiable (e.g., created, updated, deleted) because the names of the roles have not been confirmed. 


### Process
1. During the contest, a contestant (in the individual contest) or contestants (in the group contest), came across some problems.
The problems they commonly faced could be tagged as:
    - Problem Statement -- related to the question
    - Devices -- Related to their laptop
    - Backend -- Related to the cloud environment that they run their solutions on
    - Other -- Other problems faced 
However, the tags of common problems are tentative and subject to change. This means that they need to be modular and not hard-coded. 
2. The contestant will submit a ticket, which will: 
    - start a timer that indicates that the problem is being triaged 
    - show up on our dashboard and the volunteers' dashboard as a problem surfaced.
3. Volunteers will be able to click on the problem surfaced and assign themselves to it first, which will mark the problem as being "attended to".
    - The volunteer will then dispatch themselves to the contestant / group to attempt to solve their technical issue.
    - If the problem is related to the problem statement, the scientific committee will have the ability to answer the contestant's question via the dashboard.
    - If the scope of the problem is beyond the volunteer's ability, they will be able to click on "escalate" to escalate the problem to secondary helpers, such as the networking / IT staff, scientific committee, and so on.
4. Once the problem is marked resolved, the timer will stop. 
    - The problem will be marked as resolved on the dashboard, and the jury / scientific committee will be able to see a summary of the problem.
    - The jury / scientific committee can award the contestant / group a discretionary time extension with the dashboard. 

### Hosting
- The dashboard will be hosted on cloud in production. 
- Testing done locally, subject to changes
- Tentatively, it will have a Supabase backend handler with a cloudflare workers frontend.
