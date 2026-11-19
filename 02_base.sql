-- Base data: companies allowed for employee sign-up (matched by email domain,
-- subdomains included) and a starter skill list. Edit freely.
-- Check each domain against real work emails before relying on it.
INSERT INTO companies (name, domain) VALUES
  ('Infosys', 'infosys.com'),
  ('TCS', 'tcs.com'),
  ('Wipro', 'wipro.com'),
  ('Accenture', 'accenture.com'),
  ('Cognizant', 'cognizant.com'),
  ('HCLTech', 'hcl.com'),
  ('HCLTech (corporate)', 'hcltech.com'),
  ('Tech Mahindra', 'techmahindra.com'),
  ('Capgemini', 'capgemini.com'),
  ('LTIMindtree', 'ltimindtree.com'),
  ('Deloitte', 'deloitte.com'),
  ('JPMorgan Chase', 'jpmorgan.com'),
  ('Goldman Sachs', 'gs.com')
ON CONFLICT DO NOTHING;

INSERT INTO skills (name) VALUES
  ('Java'), ('Python'), ('JavaScript'), ('TypeScript'), ('React'), ('Node.js'),
  ('Spring Boot'), ('.NET'), ('Angular'), ('SQL'), ('PL/SQL'), ('Oracle'),
  ('PostgreSQL'), ('MongoDB'), ('AWS'), ('Azure'), ('GCP'), ('Docker'),
  ('Kubernetes'), ('DevOps'), ('Jenkins'), ('Terraform'), ('Linux'),
  ('Splunk'), ('Datadog'), ('Finacle'), ('SAP'), ('Selenium'), ('Manual Testing'),
  ('Cybersecurity'), ('Data Engineering'), ('Machine Learning'),
  ('Production Support'), ('ITIL'), ('Salesforce'), ('Mainframe')
ON CONFLICT DO NOTHING;
