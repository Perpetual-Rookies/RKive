Project Brief: RKive
The Intelligent Knowledge Layer for R Systems

1. Executive Summary
RKive is a reactive AI-driven knowledge retrieval solution designed to live directly within organizational messaging platforms (Slack, Microsoft Teams). It bridges the gap between employees and siloed data by transforming "buried" documentation—such as PDFs, emails, and project specs—into an instantly accessible conversational interface.

2. The Problem
Employees often lose productive time performing "manual searches" through fragmented sources (Google Drive, SharePoint, Jira, and Confluence). Information is often trapped in departmental silos or accessible only to specific project teams, leading to repetitive questions and onboarding bottlenecks.

3. The Solution
RKive acts as a centralized "Brain" and "Brawn" for the company:

The Brain (NLP & Semantic Search): Understands user intent. Rather than matching keywords, it recognizes that a question like "Can I work from the beach?" refers to the Remote Work Policy.

The Brawn (Multi-Level Data Management):

Organization Level: Instant access to company-wide FAQs, HR policies, and office protocols.

Project Level: Secure retrieval of technical specs and documentation, restricted to authorized team members.

4. Key Features
Reactive Retrieval: Provides immediate answers to employee queries in real-time within the chat flow.

RBAC (Role-Based Access Control): Integrated security that ensures users only retrieve information they are authorized to see based on organizational data.

Source Transparency: Every answer provided by RKive includes citations and links to the original source document for verification.

Crowdsourced Knowledge (Future-Ready): A built-in suggestion loop where users can propose updates to the knowledge base, which admins can approve via the LLM-generated documentation.

5. Technical Architecture (High-Level)
Interface: Messaging App Integration (Slack/Teams).

Core Engine: LLM-powered Natural Language Processing.

Data Tier: Two-tier permission structure (Org-wide vs. Project-specific).

Integration: Semantic search across siloed cloud storage and project management tools.

6. Impact
RKive streamlines internal communication, slashes the "time-to-information" for new and existing hires, and ensures that the company’s collective intelligence is always just one message away.


Notes taken
The tools cant find out and tell Sam that he has 3 leaves available. Employee level data

The tool can tell Sam to login to mpower, navigate to leaves section, with screenshot of what the page looks like, and tell him to look up how many leaves he has. Organisation level data.



Sales teams want to know previous project quotation, timelines, proposal details and success and failure rate. Project level data



Organisation level data. (Policy data) - we are definitely doing this. first priority.
Project level data (which has to be guarded) - We should try to do, because it is a good feature. second priority to this. Include in presentation.
Employee level data (absolutely has to be gurded) - we do not need to try.

Users being able to suggest changes to the knowledge base will be a, 3rd priority.



How the system gets the data.
1. Organisation level data
Train it.
Or we 

2. Project level data.
Will sales team share the data?

We can have different teams hold differt vector databases.
Our LLM solution will figure out which teams data it has to access, and before accessing it, it will check whether the user asking for the info is supposed to have access to it or not.

We have to discuss data weitage.


Proactive vs reactive.

We can have a feature where a user asks the AI to send him a report of xyz on a daily basis, the AI will generate the report and give the update to the user at the specific time interval.

