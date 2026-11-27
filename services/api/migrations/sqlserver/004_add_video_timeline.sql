-- Video Studio: lưu NLE timeline (JSON).
IF COL_LENGTH('videos', 'timeline') IS NULL
  ALTER TABLE videos ADD timeline NVARCHAR(MAX) NULL;
