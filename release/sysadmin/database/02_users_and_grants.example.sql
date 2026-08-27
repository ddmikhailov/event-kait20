-- Replace host names and passwords before executing as a database administrator.
-- Do not save the completed file in the application directory or source control.
CREATE USER 'event_app'@'APP_SERVER_HOST' IDENTIFIED BY 'CHANGE_ME';
CREATE USER 'event_migrate'@'ADMIN_HOST' IDENTIFIED BY 'CHANGE_ME';

GRANT SELECT, INSERT, UPDATE, DELETE
  ON `event_registration`.* TO 'event_app'@'APP_SERVER_HOST';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON `event_registration`.* TO 'event_migrate'@'ADMIN_HOST';
FLUSH PRIVILEGES;
