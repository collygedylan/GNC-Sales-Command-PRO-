-- Assign Ellen Ward and Murphy Stanley EVAL rows by exact inventory keys.
-- Rule key: itemcode + locationcode + plantgroupcode + commonname + contsize + source.
-- Ellen source: G:/My Drive/Plant group itemcode/Book1.xlsx, tab Ellen (907 rows, 655 distinct exact keys).
-- Murphy source: existing murphy_stanley itemcode list expanded through live public.v2_master_inventory (460 itemcodes, 1046 distinct exact keys).
-- Ellen exact rows take precedence where the older Murphy itemcode list overlaps Magnolia rows (12 exact Murphy rows skipped).

begin;

create or replace function pg_temp.tmp_eval_assignment_norm(value text)
returns text
language sql
immutable
as $$
    select upper(btrim(
        replace(
            replace(
                replace(
                    replace(coalesce(value, ''), U&'\00C2\00AE', U&'\00AE'),
                    U&'\00E2\201E\00A2',
                    U&'\2122'
                ),
                U&'\00C2\2122',
                U&'\2122'
            ),
            U&'\00E2\20AC\2122',
            chr(39)
        )
    ))
$$;

create temp table tmp_eval_exact_assignments as
select *
from jsonb_to_recordset($json$[
  {
    "assignedto": "ellen_ward",
    "itemcode": "008033.021.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Anna's Magic Ball\u00ae Arborvitae",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008033.021.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Anna's Magic Ball\u00ae Arborvitae",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008033.031.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Anna's Magic Ball\u00ae Arborvitae",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008033.031.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Anna's Magic Ball\u00ae Arborvitae",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008033.031.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Anna's Magic Ball\u00ae Arborvitae",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008033.031.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Anna's Magic Ball\u00ae Arborvitae",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008033.081.1",
    "locationcode": "E.17.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Anna's Magic Ball\u00ae Arborvitae",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008033.081.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Anna's Magic Ball\u00ae Arborvitae",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008033.081.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Anna's Magic Ball\u00ae Arborvitae",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "009477.031.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Aquavita\u2122 Juniper",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "009477.031.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Aquavita\u2122 Juniper",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "009477.070.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Aquavita\u2122 Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005725.010.1",
    "locationcode": "C.12.024",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Austrian Pine",
    "contsize": "#1",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005725.010.1",
    "locationcode": "C.12.032",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Austrian Pine",
    "contsize": "#1",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005725.070.1",
    "locationcode": "C.12.029",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Austrian Pine",
    "contsize": "#7",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005725.070.1",
    "locationcode": "C.12.034",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Austrian Pine",
    "contsize": "#7",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "006892.070.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Baby Blue Spruce",
    "contsize": "#7",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008293.030.1",
    "locationcode": "A.10.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Baker Arborvitae",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011564.050.1",
    "locationcode": "C.12.036",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Bakeri Blue Spruce",
    "contsize": "#5",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000840.010.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Berckman's Golden Arborvitae",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000840.030.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Berckman's Golden Arborvitae",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000840.030.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Berckman's Golden Arborvitae",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008247.030.1",
    "locationcode": "C.12.035",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Black Hills Spruce",
    "contsize": "#3",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "001183.050.1",
    "locationcode": "C.12.031",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Atlas Cedar",
    "contsize": "#5",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "001183.150.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Atlas Cedar",
    "contsize": "#15",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "001565.008.1",
    "locationcode": "K.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Ice Arizona Cypress",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "001565.030.1",
    "locationcode": "C.18.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Ice Arizona Cypress",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "001565.030.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Ice Arizona Cypress",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000360.010.1",
    "locationcode": "C.13.031",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Pacific Juniper",
    "contsize": "#1",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000360.010.1",
    "locationcode": "C.13.032",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Pacific Juniper",
    "contsize": "#1",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000360.020.1",
    "locationcode": "A.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Pacific Juniper",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000360.020.1",
    "locationcode": "C.12.023",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Pacific Juniper",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000360.030.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Pacific Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000360.030.1",
    "locationcode": "C.13.030",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Pacific Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000360.030.1",
    "locationcode": "C.13.031",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Pacific Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000360.030.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Pacific Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000360.030.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Pacific Juniper",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011731.020.1",
    "locationcode": "A.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Pacific Juniper Wreath",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000150.008.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000150.008.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000150.030.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000150.030.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000150.050.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000150.050.1",
    "locationcode": "K.02.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000150.070.1",
    "locationcode": "C.14.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper",
    "contsize": "#7",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000150.070.1",
    "locationcode": "D.29.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000150.070.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000150.070.2",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000150.150.1",
    "locationcode": "G.27.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000150.150.1",
    "locationcode": "L.04.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000150.150.2",
    "locationcode": "L.04.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000152.050.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper - 2 Tier Poodle",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000152.050.1",
    "locationcode": "K.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper - 2 Tier Poodle",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000152.050.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper - 2 Tier Poodle",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000152.070.1",
    "locationcode": "K.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper - 2 Tier Poodle",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000152.070.1",
    "locationcode": "L.04.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper - 2 Tier Poodle",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000156.070.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper - 3-Tier Poodle",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000154.020.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper - Spiral",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000154.020.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper - Spiral",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000154.050.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper - Spiral",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000154.050.1",
    "locationcode": "K.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper - Spiral",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000154.070.1",
    "locationcode": "K.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper - Spiral",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000154.070.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper - Spiral",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000154.150.1",
    "locationcode": "L.04.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper - Spiral",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008317.070.1",
    "locationcode": "K.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper Ball and Spire",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008317.070.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper Ball and Spire",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000151.020.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper Patio Tree",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000151.020.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper Patio Tree",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000151.050.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper Patio Tree",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000151.050.1",
    "locationcode": "K.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper Patio Tree",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000151.050.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Point Juniper Patio Tree",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000470.010.1",
    "locationcode": "C.12.024",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Rug Juniper",
    "contsize": "#1",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000470.010.1",
    "locationcode": "C.14.026",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Rug Juniper",
    "contsize": "#1",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000470.010.2",
    "locationcode": "C.14.026",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Rug Juniper",
    "contsize": "#1",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000470.020.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Rug Juniper",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000470.030.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Rug Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000470.030.1",
    "locationcode": "F.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Rug Juniper",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000470.030.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Rug Juniper",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000470.050.1",
    "locationcode": "C.14.039",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Rug Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000470.050.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Rug Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000470.050.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Rug Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000470.050.1",
    "locationcode": "J.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Rug Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000675.010.1",
    "locationcode": "C.12.034",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Star Juniper",
    "contsize": "#1",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000675.030.1",
    "locationcode": "C.12.033",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Blue Star Juniper",
    "contsize": "#3",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003194.030.1",
    "locationcode": "C.18.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Brodie Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003194.030.1",
    "locationcode": "F.18.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Brodie Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003194.070.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Brodie Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003194.150.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Brodie Juniper",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000575.010.1",
    "locationcode": "C.14.030",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Buffalo Juniper",
    "contsize": "#1",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000575.030.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Buffalo Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000575.030.1",
    "locationcode": "C.14.041",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Buffalo Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000575.030.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Buffalo Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000575.050.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Buffalo Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000575.050.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Buffalo Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000575.050.1",
    "locationcode": "J.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Buffalo Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003647.008.1",
    "locationcode": "K.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Canaerti Juniper",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003647.030.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Canaerti Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003647.030.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Canaerti Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003647.030.2",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Canaerti Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003647.050.1",
    "locationcode": "D.29.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Canaerti Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003647.050.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Canaerti Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003647.070.1",
    "locationcode": "C.14.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Canaerti Juniper",
    "contsize": "#7",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003647.070.1",
    "locationcode": "D.29.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Canaerti Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003647.070.1",
    "locationcode": "L.04.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Canaerti Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003647.070.2",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Canaerti Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003647.150.1",
    "locationcode": "G.27.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Canaerti Juniper",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003647.150.1",
    "locationcode": "L.04.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Canaerti Juniper",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003647.150.2",
    "locationcode": "L.04.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Canaerti Juniper",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003647.150.2",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Canaerti Juniper",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005452.070.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Carolina Sapphire Arizona Cypress",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005851.010.1",
    "locationcode": "C.12.038",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Colorado Blue Spruce",
    "contsize": "#1",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008254.030.1",
    "locationcode": "C.12.018",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Colorado Spruce",
    "contsize": "#3",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008254.030.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Colorado Spruce",
    "contsize": "#3",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000450.010.1",
    "locationcode": "C.14.042",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Compact Andorra Juniper",
    "contsize": "#1",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000450.020.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Compact Andorra Juniper",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000450.020.1",
    "locationcode": "C.14.028",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Compact Andorra Juniper",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000450.030.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Compact Andorra Juniper",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000450.030.1",
    "locationcode": "C.14.026",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Compact Andorra Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000450.030.1",
    "locationcode": "C.14.028",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Compact Andorra Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000450.030.1",
    "locationcode": "F.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Compact Andorra Juniper",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000450.050.1",
    "locationcode": "C.14.042",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Compact Andorra Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000450.050.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Compact Andorra Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000450.050.1",
    "locationcode": "K.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Compact Andorra Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011115.050.1",
    "locationcode": "C.12.028",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Cupressina Norway Spruce",
    "contsize": "#5",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004593.030.1",
    "locationcode": "C.12.016",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Daub's Frosted Juniper",
    "contsize": "#3",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000777.010.1",
    "locationcode": "C.14.035",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Densiformis Yew",
    "contsize": "#1",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000777.010.1",
    "locationcode": "J.04.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Densiformis Yew",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000777.010.1",
    "locationcode": "K.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Densiformis Yew",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000777.010.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Densiformis Yew",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000777.020.1",
    "locationcode": "C.14.037",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Densiformis Yew",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000777.030.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Densiformis Yew",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000777.030.1",
    "locationcode": "C.14.033",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Densiformis Yew",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000777.030.1",
    "locationcode": "C.14.034",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Densiformis Yew",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000777.030.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Densiformis Yew",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000777.030.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Densiformis Yew",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000777.030.1",
    "locationcode": "H.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Densiformis Yew",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000777.070.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Densiformis Yew",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000777.070.1",
    "locationcode": "H.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Densiformis Yew",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "002227.010.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Duke Gardens Plum Yew",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "002227.030.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Duke Gardens Plum Yew",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000758.010.1",
    "locationcode": "C.12.039",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Dwarf Alberta Spruce",
    "contsize": "#1",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000758.030.1",
    "locationcode": "C.12.024",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Dwarf Alberta Spruce",
    "contsize": "#3",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000758.030.1",
    "locationcode": "C.12.040",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Dwarf Alberta Spruce",
    "contsize": "#3",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "002788.030.1",
    "locationcode": "C.12.033",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Dwarf Alberta Spruce 3-Tier Poodle",
    "contsize": "#3",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000756.030.1",
    "locationcode": "C.12.032",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Dwarf Alberta Spruce Spiral",
    "contsize": "#3",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "006914.050.1",
    "locationcode": "C.12.032",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Dwarf Blue Spruce Globe High-Graft",
    "contsize": "#5",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "006914.100.1",
    "locationcode": "C.12.025",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Dwarf Blue Spruce Globe High-Graft",
    "contsize": "#10",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004563.050.1",
    "locationcode": "C.12.034",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Dwarf Blue Spruce Globe Low-Graft",
    "contsize": "#5",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004563.070.1",
    "locationcode": "C.12.025",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Dwarf Blue Spruce Globe Low-Graft",
    "contsize": "#7",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004563.100.1",
    "locationcode": "C.12.025",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Dwarf Blue Spruce Globe Low-Graft",
    "contsize": "#10",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "002355.008.1",
    "locationcode": "C.14.039",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Eastern Red Cedar",
    "contsize": "8 IN.",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "002355.008.1",
    "locationcode": "C.14.041",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Eastern Red Cedar",
    "contsize": "8 IN.",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "002355.030.1",
    "locationcode": "C.14.044",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Eastern Red Cedar",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "002355.070.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Eastern Red Cedar",
    "contsize": "#7",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000764.030.1",
    "locationcode": "C.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Eastern White Pine",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004186.050.1",
    "locationcode": "C.12.031",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Electra Blue Deodar Cedar",
    "contsize": "#5",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000815.008.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Emerald Arborvitae",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000815.020.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Emerald Arborvitae",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000815.020.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Emerald Arborvitae",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000815.030.1",
    "locationcode": "C.14.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Emerald Arborvitae",
    "contsize": "#3",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000815.050.1",
    "locationcode": "C.12.028",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Emerald Arborvitae",
    "contsize": "#5",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000815.050.1",
    "locationcode": "C.12.040",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Emerald Arborvitae",
    "contsize": "#5",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000815.070.1",
    "locationcode": "C.12.037",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Emerald Arborvitae",
    "contsize": "#7",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005544.010.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Emerald Teardrop\u2122 Arborvitae",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005544.010.1",
    "locationcode": "J.04.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Emerald Teardrop\u2122 Arborvitae",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005544.010.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Emerald Teardrop\u2122 Arborvitae",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005544.030.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Emerald Teardrop\u2122 Arborvitae",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005544.030.1",
    "locationcode": "J.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Emerald Teardrop\u2122 Arborvitae",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004493.010.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Everlow Yew",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004493.010.1",
    "locationcode": "E.10.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Everlow Yew",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004493.010.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Everlow Yew",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004493.010.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Everlow Yew",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004493.030.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Everlow Yew",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004493.030.1",
    "locationcode": "E.10.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Everlow Yew",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004493.030.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Everlow Yew",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004493.030.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Everlow Yew",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010460.030.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Everyst\u2122 Arborvitae",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010460.030.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Everyst\u2122 Arborvitae",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010460.070.1",
    "locationcode": "D.29.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Everyst\u2122 Arborvitae",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010460.150.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Everyst\u2122 Arborvitae",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "006450.070.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Fat Albert Colorado Blue Spruce",
    "contsize": "#7",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003295.008.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Fire Chief\u2122 Arborvitae",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003295.008.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Fire Chief\u2122 Arborvitae",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003295.020.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Fire Chief\u2122 Arborvitae",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003295.020.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Fire Chief\u2122 Arborvitae",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003295.020.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Fire Chief\u2122 Arborvitae",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003295.030.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Fire Chief\u2122 Arborvitae",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003295.030.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Fire Chief\u2122 Arborvitae",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005117.020.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Full Speed A Hedge\u00ae American Pillar Arborvitae",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005117.030.1",
    "locationcode": "E.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Full Speed A Hedge\u00ae American Pillar Arborvitae",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005117.070.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Full Speed A Hedge\u00ae American Pillar Arborvitae",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005117.070.2",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Full Speed A Hedge\u00ae American Pillar Arborvitae",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004592.020.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Cone Juniper",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004592.020.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Cone Juniper",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000635.010.1",
    "locationcode": "C.12.024",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Lace Juniper",
    "contsize": "#1",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000635.020.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Lace Juniper",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000635.030.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Lace Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000635.030.1",
    "locationcode": "C.12.024",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Lace Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000635.050.1",
    "locationcode": "C.14.033",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Lace Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000635.050.1",
    "locationcode": "C.14.043",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Lace Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000101.010.1",
    "locationcode": "E.17.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Mop Falsecypress",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000101.010.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Mop Falsecypress",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000101.010.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Mop Falsecypress",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000101.020.1",
    "locationcode": "D.04.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Mop Falsecypress",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000101.020.1",
    "locationcode": "E.17.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Mop Falsecypress",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000101.020.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Mop Falsecypress",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000101.020.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Mop Falsecypress",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000101.030.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Mop Falsecypress",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000101.030.1",
    "locationcode": "E.17.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Mop Falsecypress",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000101.030.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Mop Falsecypress",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000101.030.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Mop Falsecypress",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000101.030.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Mop Falsecypress",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000101.050.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Mop Falsecypress",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000101.050.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Mop Falsecypress",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000101.070.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Mop Falsecypress",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "002491.030.1",
    "locationcode": "C.18.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Rider Leyland Cypress",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "002491.030.1",
    "locationcode": "F.18.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Gold Rider Leyland Cypress",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "009402.008.1",
    "locationcode": "K.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Golden Frost\u2122 Juniper",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "009402.021.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Golden Frost\u2122 Juniper",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "009402.030.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Golden Frost\u2122 Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "009402.050.1",
    "locationcode": "D.29.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Golden Frost\u2122 Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010473.030.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Golden Globe Arborvitae",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "002113.030.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Golden Hinoki (Crippsii) Falsecypress",
    "contsize": "#3",
    "source": "NC"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004832.011.1",
    "locationcode": "E.17.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Golden Pacific\u2122 Juniper",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004832.011.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Golden Pacific\u2122 Juniper",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004832.011.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Golden Pacific\u2122 Juniper",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004832.021.1",
    "locationcode": "E.17.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Golden Pacific\u2122 Juniper",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004832.021.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Golden Pacific\u2122 Juniper",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004832.021.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Golden Pacific\u2122 Juniper",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004832.031.1",
    "locationcode": "C.13.034",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Golden Pacific\u2122 Juniper",
    "contsize": "3DP",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004832.031.1",
    "locationcode": "C.13.038",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Golden Pacific\u2122 Juniper",
    "contsize": "3DP",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004832.031.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Golden Pacific\u2122 Juniper",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004832.031.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Golden Pacific\u2122 Juniper",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004832.031.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Golden Pacific\u2122 Juniper",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000808.008.1",
    "locationcode": "C.14.044",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Giant Arborvitae",
    "contsize": "8 IN.",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000808.008.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Giant Arborvitae",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000808.008.1",
    "locationcode": "K.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Giant Arborvitae",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000808.008.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Giant Arborvitae",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000808.020.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Giant Arborvitae",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000808.030.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Giant Arborvitae",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000808.030.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Giant Arborvitae",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000808.030.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Giant Arborvitae",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000808.050.1",
    "locationcode": "I.11.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Giant Arborvitae",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000808.050.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Giant Arborvitae",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000808.070.1",
    "locationcode": "C.14.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Giant Arborvitae",
    "contsize": "#7",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000808.070.1",
    "locationcode": "D.29.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Giant Arborvitae",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000808.070.1",
    "locationcode": "L.04.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Giant Arborvitae",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000808.070.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Giant Arborvitae",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000808.150.1",
    "locationcode": "G.27.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Giant Arborvitae",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000808.150.1",
    "locationcode": "L.04.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Giant Arborvitae",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000300.010.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Sargent Juniper",
    "contsize": "#1",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000300.020.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Sargent Juniper",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000300.020.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Sargent Juniper",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000300.030.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Sargent Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000300.030.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Sargent Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000300.050.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Sargent Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000300.050.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Sargent Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000300.050.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Sargent Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000300.050.1",
    "locationcode": "J.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Green Sargent Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000550.010.1",
    "locationcode": "B.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Greenmound Procumbens Juniper",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000550.010.1",
    "locationcode": "K.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Greenmound Procumbens Juniper",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000550.010.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Greenmound Procumbens Juniper",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000550.020.1",
    "locationcode": "B.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Greenmound Procumbens Juniper",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000550.020.1",
    "locationcode": "K.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Greenmound Procumbens Juniper",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000550.020.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Greenmound Procumbens Juniper",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000550.030.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Greenmound Procumbens Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000550.030.1",
    "locationcode": "C.14.028",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Greenmound Procumbens Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000550.030.1",
    "locationcode": "F.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Greenmound Procumbens Juniper",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000550.030.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Greenmound Procumbens Juniper",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000550.050.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Greenmound Procumbens Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000550.050.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Greenmound Procumbens Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000550.050.1",
    "locationcode": "J.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Greenmound Procumbens Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005670.011.1",
    "locationcode": "B.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Guardian\u2122 Juniper",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005670.011.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Guardian\u2122 Juniper",
    "contsize": "#1D",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005670.011.1",
    "locationcode": "C.14.026",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Guardian\u2122 Juniper",
    "contsize": "#1D",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005670.011.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Guardian\u2122 Juniper",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005670.021.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Guardian\u2122 Juniper",
    "contsize": "2DP",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005670.021.1",
    "locationcode": "C.14.032",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Guardian\u2122 Juniper",
    "contsize": "2DP",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005670.031.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Guardian\u2122 Juniper",
    "contsize": "3DP",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005670.031.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Guardian\u2122 Juniper",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005670.031.1",
    "locationcode": "F.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Guardian\u2122 Juniper",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005670.031.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Guardian\u2122 Juniper",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005670.051.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Guardian\u2122 Juniper",
    "contsize": "5DP",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005670.051.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Guardian\u2122 Juniper",
    "contsize": "5DP",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005670.051.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Guardian\u2122 Juniper",
    "contsize": "5DP",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005670.051.1",
    "locationcode": "J.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Guardian\u2122 Juniper",
    "contsize": "5DP",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011859.050.1",
    "locationcode": "A.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Guardian\u2122 Juniper Pom Pom",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011860.050.1",
    "locationcode": "A.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Guardian\u2122 Juniper Serpentine",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011732.021.1",
    "locationcode": "A.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Guardian\u2122 Juniper Wreath",
    "contsize": "2DP",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000720.010.1",
    "locationcode": "A.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Owl Juniper",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000720.010.1",
    "locationcode": "B.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Owl Juniper",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000720.010.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Owl Juniper",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000720.020.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Owl Juniper",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000720.020.1",
    "locationcode": "C.14.025",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Owl Juniper",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000720.030.1",
    "locationcode": "A.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Owl Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000720.030.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Owl Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000720.030.1",
    "locationcode": "C.14.031",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Owl Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000720.030.1",
    "locationcode": "F.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Owl Juniper",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000720.050.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Owl Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000720.050.1",
    "locationcode": "C.14.028",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Owl Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000720.050.1",
    "locationcode": "C.14.038",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Owl Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000720.050.1",
    "locationcode": "C.14.038",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Owl Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000720.050.1",
    "locationcode": "K.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Owl Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000720.070.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Owl Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000720.070.1",
    "locationcode": "J.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Owl Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003338.050.1",
    "locationcode": "A.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Owl Juniper Pom Pom",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011861.050.1",
    "locationcode": "A.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Grey Owl Juniper Serpentine",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000790.010.1",
    "locationcode": "C.12.024",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetz Midget Arborvitae",
    "contsize": "#1",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000790.030.1",
    "locationcode": "C.14.032",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetz Midget Arborvitae",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000790.030.1",
    "locationcode": "F.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetz Midget Arborvitae",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000180.008.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Column Juniper",
    "contsize": "8 IN.",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000180.008.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Column Juniper",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000180.008.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Column Juniper",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000180.030.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Column Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000180.030.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Column Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000180.050.1",
    "locationcode": "K.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Column Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000180.050.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Column Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000180.070.1",
    "locationcode": "C.14.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Column Juniper",
    "contsize": "#7",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000180.070.1",
    "locationcode": "D.29.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Column Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000180.070.1",
    "locationcode": "L.04.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Column Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000180.070.2",
    "locationcode": "L.04.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Column Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000180.150.1",
    "locationcode": "G.27.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Column Juniper",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000180.150.1",
    "locationcode": "L.04.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Column Juniper",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000185.070.1",
    "locationcode": "K.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Column Juniper Spiral",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000185.150.1",
    "locationcode": "G.27.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Column Juniper Spiral",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000185.150.1",
    "locationcode": "L.04.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Column Juniper Spiral",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000191.008.1",
    "locationcode": "K.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Juniper Pom Pom",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000191.008.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Juniper Pom Pom",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000191.050.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Juniper Pom Pom",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000191.050.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hetzi Juniper Pom Pom",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005961.020.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Highlights\u00ae Arborvitae",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005961.020.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Highlights\u00ae Arborvitae",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005961.030.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Highlights\u00ae Arborvitae",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005961.030.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Highlights\u00ae Arborvitae",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005961.030.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Highlights\u00ae Arborvitae",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000340.008.1",
    "locationcode": "B.02.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hollywood Juniper",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000340.008.1",
    "locationcode": "C.18.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hollywood Juniper",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000340.008.1",
    "locationcode": "F.18.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hollywood Juniper",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000340.030.1",
    "locationcode": "B.02.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hollywood Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000340.030.1",
    "locationcode": "F.18.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hollywood Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000340.050.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hollywood Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000340.070.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hollywood Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011580.070.1",
    "locationcode": "C.12.041",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Hoop's Blue Spruce",
    "contsize": "#7",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003796.030.1",
    "locationcode": "C.18.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Horstmann Blue Atlas Cedar",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000260.010.1",
    "locationcode": "B.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Kallay Pfitzer Juniper",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000260.010.1",
    "locationcode": "C.14.033",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Kallay Pfitzer Juniper",
    "contsize": "#1",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000260.010.2",
    "locationcode": "C.14.033",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Kallay Pfitzer Juniper",
    "contsize": "#1",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000260.020.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Kallay Pfitzer Juniper",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000260.030.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Kallay Pfitzer Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000260.030.1",
    "locationcode": "C.14.040",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Kallay Pfitzer Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000260.030.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Kallay Pfitzer Juniper",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000260.050.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Kallay Pfitzer Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000260.050.1",
    "locationcode": "C.14.027",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Kallay Pfitzer Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000260.050.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Kallay Pfitzer Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000260.050.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Kallay Pfitzer Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000260.050.1",
    "locationcode": "J.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Kallay Pfitzer Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011729.020.1",
    "locationcode": "A.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Kallay Pfitzer Juniper Wreath",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010640.030.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Kashyma\u2122 Cryptomeria",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010640.070.1",
    "locationcode": "D.29.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Kashyma\u2122 Cryptomeria",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000571.008.1",
    "locationcode": "K.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Keteleeri Juniper",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000571.008.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Keteleeri Juniper",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000571.030.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Keteleeri Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000571.050.1",
    "locationcode": "K.02.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Keteleeri Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000571.070.1",
    "locationcode": "C.14.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Keteleeri Juniper",
    "contsize": "#7",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000571.070.1",
    "locationcode": "D.29.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Keteleeri Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000571.070.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Keteleeri Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000571.070.1",
    "locationcode": "G.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Keteleeri Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000571.150.1",
    "locationcode": "G.27.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Keteleeri Juniper",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003068.010.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "King's Gold Falsecypress",
    "contsize": "#1",
    "source": "NC"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003068.010.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "King's Gold Falsecypress",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003068.010.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "King's Gold Falsecypress",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003068.010.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "King's Gold Falsecypress",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003068.020.1",
    "locationcode": "D.04.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "King's Gold Falsecypress",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003068.020.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "King's Gold Falsecypress",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003068.020.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "King's Gold Falsecypress",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003068.020.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "King's Gold Falsecypress",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003068.030.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "King's Gold Falsecypress",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003068.030.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "King's Gold Falsecypress",
    "contsize": "#3",
    "source": "NC"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003068.030.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "King's Gold Falsecypress",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003068.030.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "King's Gold Falsecypress",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003068.030.2",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "King's Gold Falsecypress",
    "contsize": "#3",
    "source": "NC"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003068.070.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "King's Gold Falsecypress",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "007395.010.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Lime Delight Arborvitae",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "007395.030.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Lime Delight Arborvitae",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "007395.030.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Lime Delight Arborvitae",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010167.010.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Little Silhouette\u2122 Arborvitae",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010167.031.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Little Silhouette\u2122 Arborvitae",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010167.031.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Little Silhouette\u2122 Arborvitae",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010167.031.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Little Silhouette\u2122 Arborvitae",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010167.070.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Little Silhouette\u2122 Arborvitae",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000772.030.1",
    "locationcode": "C.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Loblolly Pine",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000772.050.1",
    "locationcode": "C.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Loblolly Pine",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000772.070.1",
    "locationcode": "L.02.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Loblolly Pine",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000577.020.1",
    "locationcode": "C.14.027",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mini Arcadia Juniper",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000577.030.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mini Arcadia Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000577.030.1",
    "locationcode": "C.14.029",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mini Arcadia Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000577.050.1",
    "locationcode": "C.14.043",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mini Arcadia Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000577.050.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mini Arcadia Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000577.050.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mini Arcadia Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000577.050.1",
    "locationcode": "J.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mini Arcadia Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011855.030.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Moffatt Blue Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011619.030.1",
    "locationcode": "B.13.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Montezuma Cypress",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011619.050.1",
    "locationcode": "B.11.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Montezuma Cypress",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003002.008.1",
    "locationcode": "E.17.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mr. Bowling Ball\u00ae Arborvitae",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003002.008.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mr. Bowling Ball\u00ae Arborvitae",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003002.008.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mr. Bowling Ball\u00ae Arborvitae",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003002.008.1",
    "locationcode": "J.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mr. Bowling Ball\u00ae Arborvitae",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003002.010.1",
    "locationcode": "E.17.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mr. Bowling Ball\u00ae Arborvitae",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003002.020.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mr. Bowling Ball\u00ae Arborvitae",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003002.020.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mr. Bowling Ball\u00ae Arborvitae",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003002.030.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mr. Bowling Ball\u00ae Arborvitae",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003002.030.1",
    "locationcode": "C.14.023",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mr. Bowling Ball\u00ae Arborvitae",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003002.030.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mr. Bowling Ball\u00ae Arborvitae",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003002.030.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mr. Bowling Ball\u00ae Arborvitae",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003002.030.1",
    "locationcode": "J.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mr. Bowling Ball\u00ae Arborvitae",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003002.050.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mr. Bowling Ball\u00ae Arborvitae",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003002.050.1",
    "locationcode": "J.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mr. Bowling Ball\u00ae Arborvitae",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000762.020.1",
    "locationcode": "C.12.038",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mugo Pine",
    "contsize": "#2",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000762.030.1",
    "locationcode": "C.12.043",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Mugo Pine",
    "contsize": "#3",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "006916.030.1",
    "locationcode": "B.02.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Murray Leyland Cypress",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "006916.030.1",
    "locationcode": "C.18.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Murray Leyland Cypress",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "006916.030.1",
    "locationcode": "F.18.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Murray Leyland Cypress",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "006916.070.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Murray Leyland Cypress",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "006916.150.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Murray Leyland Cypress",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011856.008.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "N/S Cindy's Juniper",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010546.030.1",
    "locationcode": "E.10.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "N/SP Densiformis Yew Pure Strain",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010546.030.1",
    "locationcode": "F.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "N/SP Densiformis Yew Pure Strain",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010546.030.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "N/SP Densiformis Yew Pure Strain",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000710.008.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "N/U Hillspire Juniper",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004657.031.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "North Pole\u00ae Arborvitae",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004657.031.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "North Pole\u00ae Arborvitae",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004657.031.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "North Pole\u00ae Arborvitae",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004657.051.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "North Pole\u00ae Arborvitae",
    "contsize": "5DP",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004657.081.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "North Pole\u00ae Arborvitae",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004657.081.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "North Pole\u00ae Arborvitae",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004657.081.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "North Pole\u00ae Arborvitae",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "004657.100.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "North Pole\u00ae Arborvitae",
    "contsize": "#10",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010778.070.1",
    "locationcode": "C.12.033",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Oregon Green Austrian Pine",
    "contsize": "#7",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003549.008.1",
    "locationcode": "K.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Perfecta Juniper",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003549.008.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Perfecta Juniper",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003549.030.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Perfecta Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003549.030.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Perfecta Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003549.050.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Perfecta Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003549.050.1",
    "locationcode": "K.02.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Perfecta Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003549.070.1",
    "locationcode": "C.14.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Perfecta Juniper",
    "contsize": "#7",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003549.070.1",
    "locationcode": "D.29.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Perfecta Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003549.070.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Perfecta Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003549.070.2",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Perfecta Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010309.031.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Private Jet\u2122 Arborvitae",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010309.031.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Private Jet\u2122 Arborvitae",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010309.070.1",
    "locationcode": "D.29.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Private Jet\u2122 Arborvitae",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "002776.010.1",
    "locationcode": "E.10.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Prostrate Japanese Plum Yew",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "002776.010.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Prostrate Japanese Plum Yew",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "002776.030.1",
    "locationcode": "C.18.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Prostrate Japanese Plum Yew",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "002776.030.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Prostrate Japanese Plum Yew",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "009246.030.1",
    "locationcode": "C.18.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Quick Frost\u2122 Arizona Cypress",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "009246.250.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Quick Frost\u2122 Arizona Cypress",
    "contsize": "#25",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "009246.250.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Quick Frost\u2122 Arizona Cypress",
    "contsize": "#25",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000636.010.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Saybrook Gold\u00ae Juniper",
    "contsize": "#1",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000636.010.1",
    "locationcode": "C.14.024",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Saybrook Gold\u00ae Juniper",
    "contsize": "#1",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000636.020.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Saybrook Gold\u00ae Juniper",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000636.020.1",
    "locationcode": "C.14.030",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Saybrook Gold\u00ae Juniper",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000636.030.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Saybrook Gold\u00ae Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000636.030.1",
    "locationcode": "C.12.024",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Saybrook Gold\u00ae Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000636.030.1",
    "locationcode": "C.14.044",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Saybrook Gold\u00ae Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000636.030.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Saybrook Gold\u00ae Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000636.050.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Saybrook Gold\u00ae Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000636.050.1",
    "locationcode": "C.14.033",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Saybrook Gold\u00ae Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000636.050.1",
    "locationcode": "C.14.043",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Saybrook Gold\u00ae Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011730.020.1",
    "locationcode": "A.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Saybrook Gold\u00ae Juniper Wreath",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010477.050.1",
    "locationcode": "C.12.031",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Scotch Pine Pom Pom",
    "contsize": "#5",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000310.010.1",
    "locationcode": "C.12.025",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sea Green Juniper",
    "contsize": "#1",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000310.020.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sea Green Juniper",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000310.020.1",
    "locationcode": "C.14.038",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sea Green Juniper",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000310.020.1",
    "locationcode": "C.14.043",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sea Green Juniper",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000310.030.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sea Green Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000310.030.1",
    "locationcode": "C.14.024",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sea Green Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000310.030.1",
    "locationcode": "C.14.035",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sea Green Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000310.050.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sea Green Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000310.050.1",
    "locationcode": "C.14.036",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sea Green Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000310.050.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sea Green Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000310.050.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sea Green Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000310.050.1",
    "locationcode": "K.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sea Green Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000310.070.1",
    "locationcode": "J.03.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sea Green Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010809.050.1",
    "locationcode": "A.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sea Green Juniper -Spiral",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010809.070.1",
    "locationcode": "A.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sea Green Juniper -Spiral",
    "contsize": "#7",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010809.070.1",
    "locationcode": "B.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sea Green Juniper -Spiral",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011266.050.1",
    "locationcode": "A.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sea Green Juniper Pom Pom",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011266.070.1",
    "locationcode": "B.01.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sea Green Juniper Pom Pom",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000759.030.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Shortleaf Pine",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000759.050.1",
    "locationcode": "C.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Shortleaf Pine",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000759.050.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Shortleaf Pine",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000580.020.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Skandia Juniper",
    "contsize": "#2",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000580.030.1",
    "locationcode": "C.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Skandia Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000580.030.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Skandia Juniper",
    "contsize": "#3",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000760.050.1",
    "locationcode": "C.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Slash Pine",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005545.050.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Slender Giant\u2122 Arborvitae",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "005545.070.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Slender Giant\u2122 Arborvitae",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003645.050.1",
    "locationcode": "C.14.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Spartan Juniper",
    "contsize": "#5",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003645.070.1",
    "locationcode": "C.14.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Spartan Juniper",
    "contsize": "#7",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003645.150.1",
    "locationcode": "C.14.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Spartan Juniper",
    "contsize": "#15",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000860.010.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sunkist Arborvitae",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000860.030.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sunkist Arborvitae",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000860.030.1",
    "locationcode": "G.23.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sunkist Arborvitae",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000860.030.1",
    "locationcode": "G.25.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Sunkist Arborvitae",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000745.008.1",
    "locationcode": "G.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Taylor Juniper",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000745.008.1",
    "locationcode": "K.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Taylor Juniper",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000745.030.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Taylor Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000745.030.1",
    "locationcode": "I.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Taylor Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000745.050.1",
    "locationcode": "F.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Taylor Juniper",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000745.050.1",
    "locationcode": "G.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Taylor Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000745.050.1",
    "locationcode": "G.18.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Taylor Juniper",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000745.050.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Taylor Juniper",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000745.050.2",
    "locationcode": "G.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Taylor Juniper",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000745.070.1",
    "locationcode": "C.14.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Taylor Juniper",
    "contsize": "#7",
    "source": "HL"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000745.070.1",
    "locationcode": "G.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Taylor Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000745.070.2",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Taylor Juniper",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000745.150.1",
    "locationcode": "G.12.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Taylor Juniper",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011055.030.1",
    "locationcode": "L.05.000",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Trautman Juniper",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010779.050.1",
    "locationcode": "C.12.032",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Weeping Blue Atlas Cedar Serpentine",
    "contsize": "#5",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "006891.070.1",
    "locationcode": "C.12.033",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Weeping Norway Spruce",
    "contsize": "#7",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011808.250.1",
    "locationcode": "C.12.033",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Weeping White Pine",
    "contsize": "#25",
    "source": "PO"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "006629.008.1",
    "locationcode": "D.08.060",
    "plantgroupcode": "230_CONIFE",
    "commonname": "Wilma Goldcrest Lemon Cypress",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008350.010.1",
    "locationcode": "C.16.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Ann Magnolia",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008350.030.1",
    "locationcode": "D.23.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Ann Magnolia",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008350.030.1",
    "locationcode": "F.04.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Ann Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008350.030.1",
    "locationcode": "I.07.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Ann Magnolia",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008350.050.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Ann Magnolia",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008350.050.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Ann Magnolia",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008350.050.1",
    "locationcode": "E.01.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Ann Magnolia",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008350.050.1",
    "locationcode": "E.22.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Ann Magnolia",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008350.050.1",
    "locationcode": "I.07.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Ann Magnolia",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008350.070.1",
    "locationcode": "F.17.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Ann Magnolia",
    "contsize": "#7",
    "source": "BR"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008350.070.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Ann Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008350.070.1",
    "locationcode": "I.05.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Ann Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008350.100.1",
    "locationcode": "G.09.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Ann Magnolia",
    "contsize": "#10",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008350.100.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Ann Magnolia",
    "contsize": "#10",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008350.150.1",
    "locationcode": "F.05.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Ann Magnolia",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008345.010.1",
    "locationcode": "C.16.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Betty Magnolia",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008345.030.1",
    "locationcode": "F.04.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Betty Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008345.030.1",
    "locationcode": "G.09.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Betty Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008345.030.1",
    "locationcode": "I.07.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Betty Magnolia",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008345.050.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Betty Magnolia",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008345.050.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Betty Magnolia",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008345.050.1",
    "locationcode": "E.01.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Betty Magnolia",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008345.050.1",
    "locationcode": "E.22.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Betty Magnolia",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008345.050.1",
    "locationcode": "I.07.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Betty Magnolia",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008345.070.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Betty Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008345.070.1",
    "locationcode": "I.05.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Betty Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008345.100.1",
    "locationcode": "F.05.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Betty Magnolia",
    "contsize": "#10",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008345.100.1",
    "locationcode": "G.09.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Betty Magnolia",
    "contsize": "#10",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008375.030.1",
    "locationcode": "D.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Bracken's Brown Beauty Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008375.030.1",
    "locationcode": "F.04.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Bracken's Brown Beauty Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008375.030.1",
    "locationcode": "G.06.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Bracken's Brown Beauty Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008375.030.1",
    "locationcode": "I.06.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Bracken's Brown Beauty Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008375.070.1",
    "locationcode": "F.10.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Bracken's Brown Beauty Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008375.070.1",
    "locationcode": "F.15.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Bracken's Brown Beauty Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008375.070.1",
    "locationcode": "I.05.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Bracken's Brown Beauty Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008375.150.1",
    "locationcode": "A.08.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Bracken's Brown Beauty Magnolia",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008375.150.1",
    "locationcode": "C.08.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Bracken's Brown Beauty Magnolia",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008375.150.1",
    "locationcode": "F.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Bracken's Brown Beauty Magnolia",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008375.150.1",
    "locationcode": "G.09.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Bracken's Brown Beauty Magnolia",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008375.150.1",
    "locationcode": "I.02.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Bracken's Brown Beauty Magnolia",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008375.250.1",
    "locationcode": "A.08.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Bracken's Brown Beauty Magnolia",
    "contsize": "#25",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "006042.030.1",
    "locationcode": "I.10.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Bracken's Brown Beauty Magnolia Espalier",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "006042.070.1",
    "locationcode": "C.08.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Bracken's Brown Beauty Magnolia Espalier",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "006042.070.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Bracken's Brown Beauty Magnolia Espalier",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011279.070.1",
    "locationcode": "I.04.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Centennial Blush Star Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010987.030.1",
    "locationcode": "F.04.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Genie Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010987.050.1",
    "locationcode": "E.01.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Genie Magnolia",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010987.070.1",
    "locationcode": "I.05.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Genie Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011569.250.1",
    "locationcode": "C.10.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Genie Magnolia Clump",
    "contsize": "#25",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011487.050.1",
    "locationcode": "E.22.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Genie Magnolia Tree Form",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011487.050.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Genie Magnolia Tree Form",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "011487.100.1",
    "locationcode": "F.05.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Genie Magnolia Tree Form",
    "contsize": "#10",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008358.010.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Jane Magnolia",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008358.010.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Jane Magnolia",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008358.030.1",
    "locationcode": "D.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Jane Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008358.030.1",
    "locationcode": "D.23.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Jane Magnolia",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008358.030.1",
    "locationcode": "F.04.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Jane Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008358.050.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Jane Magnolia",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008358.050.1",
    "locationcode": "D.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Jane Magnolia",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008358.050.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Jane Magnolia",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008358.050.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Jane Magnolia",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008358.050.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Jane Magnolia",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008358.050.1",
    "locationcode": "E.01.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Jane Magnolia",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008358.050.1",
    "locationcode": "E.22.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Jane Magnolia",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008358.070.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Jane Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008358.070.1",
    "locationcode": "I.05.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Jane Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008358.100.1",
    "locationcode": "G.09.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Jane Magnolia",
    "contsize": "#10",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008358.150.1",
    "locationcode": "F.05.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Jane Magnolia",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003296.030.1",
    "locationcode": "D.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Kay Parris Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003296.030.1",
    "locationcode": "I.10.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Kay Parris Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "003296.070.1",
    "locationcode": "I.05.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Kay Parris Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "010459.150.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Keltyk\u00ae Sweetbay Magnolia",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008365.030.1",
    "locationcode": "D.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008365.030.1",
    "locationcode": "G.06.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008365.030.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008365.030.1",
    "locationcode": "H.08.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008365.030.1",
    "locationcode": "I.06.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008365.070.1",
    "locationcode": "F.06.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008365.070.1",
    "locationcode": "G.06.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008365.070.1",
    "locationcode": "H.04.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008365.070.1",
    "locationcode": "H.05.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008365.070.2",
    "locationcode": "F.06.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008365.150.1",
    "locationcode": "A.08.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008365.150.1",
    "locationcode": "C.08.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008365.150.1",
    "locationcode": "F.05.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008365.150.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008366.030.1",
    "locationcode": "D.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia - Espalier",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008366.030.1",
    "locationcode": "F.20.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia - Espalier",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008366.070.1",
    "locationcode": "F.06.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia - Espalier",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008366.070.1",
    "locationcode": "F.20.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia - Espalier",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008366.070.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia - Espalier",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008366.150.1",
    "locationcode": "D.24.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia - Espalier",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008366.150.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Little Gem Magnolia - Espalier",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008410.030.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Royal Star Magnolia",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008410.030.1",
    "locationcode": "F.04.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Royal Star Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008410.050.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Royal Star Magnolia",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008410.050.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Royal Star Magnolia",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008410.050.1",
    "locationcode": "E.01.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Royal Star Magnolia",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008410.050.1",
    "locationcode": "E.22.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Royal Star Magnolia",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008410.070.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Royal Star Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008410.070.1",
    "locationcode": "I.05.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Royal Star Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008380.030.1",
    "locationcode": "D.10.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Saucer Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008380.030.1",
    "locationcode": "F.04.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Saucer Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008380.050.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Saucer Magnolia",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008380.050.1",
    "locationcode": "E.01.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Saucer Magnolia",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008380.050.1",
    "locationcode": "E.22.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Saucer Magnolia",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008380.070.1",
    "locationcode": "F.10.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Saucer Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008380.070.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Saucer Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008380.070.1",
    "locationcode": "I.05.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Saucer Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008360.030.1",
    "locationcode": "D.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Southern Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008360.030.1",
    "locationcode": "F.04.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Southern Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008360.050.1",
    "locationcode": "G.06.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Southern Magnolia",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008360.070.1",
    "locationcode": "C.10.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Southern Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008360.070.2",
    "locationcode": "F.10.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Southern Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008360.100.1",
    "locationcode": "C.10.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Southern Magnolia",
    "contsize": "#10",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008360.150.1",
    "locationcode": "G.09.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Southern Magnolia",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008361.030.1",
    "locationcode": "F.04.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Sweetbay Magnolia (Shrub-Form)",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008361.070.1",
    "locationcode": "F.05.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Sweetbay Magnolia (Shrub-Form)",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "008361.070.2",
    "locationcode": "F.10.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Sweetbay Magnolia (Shrub-Form)",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000804.030.1",
    "locationcode": "F.06.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Teddy Bear\u00ae Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000804.030.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Teddy Bear\u00ae Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000804.030.1",
    "locationcode": "H.08.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Teddy Bear\u00ae Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000804.030.1",
    "locationcode": "I.06.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Teddy Bear\u00ae Magnolia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000804.070.1",
    "locationcode": "F.06.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Teddy Bear\u00ae Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000804.070.1",
    "locationcode": "G.06.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Teddy Bear\u00ae Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000804.070.1",
    "locationcode": "H.04.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Teddy Bear\u00ae Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000804.070.1",
    "locationcode": "H.05.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Teddy Bear\u00ae Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000804.070.2",
    "locationcode": "G.06.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Teddy Bear\u00ae Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000804.070.2",
    "locationcode": "H.04.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Teddy Bear\u00ae Magnolia",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000804.150.1",
    "locationcode": "F.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Teddy Bear\u00ae Magnolia",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000804.150.1",
    "locationcode": "G.09.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Teddy Bear\u00ae Magnolia",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "ellen_ward",
    "itemcode": "000804.150.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Teddy Bear\u00ae Magnolia",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003585.011.1",
    "locationcode": "G.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Admiration Barberry",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003585.011.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Admiration Barberry",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003585.021.1",
    "locationcode": "G.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Admiration Barberry",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003585.021.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Admiration Barberry",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003585.031.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Admiration Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003585.031.1",
    "locationcode": "D.33.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Admiration Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003585.031.1",
    "locationcode": "F.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Admiration Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003585.031.1",
    "locationcode": "G.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Admiration Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003585.031.1",
    "locationcode": "H.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Admiration Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008390.021.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Afterglow\u2122 Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008390.021.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Afterglow\u2122 Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000706.010.1",
    "locationcode": "D.23.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Amethyst Falls Wisteria - Staked",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000706.020.1",
    "locationcode": "0.00.111",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Amethyst Falls Wisteria - Staked",
    "contsize": "#2",
    "source": ""
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000706.020.1",
    "locationcode": "D.23.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Amethyst Falls Wisteria - Staked",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000706.030.1",
    "locationcode": "D.23.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Amethyst Falls Wisteria - Staked",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000706.030.1",
    "locationcode": "G.01.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Amethyst Falls Wisteria - Staked",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000706.030.1",
    "locationcode": "J.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Amethyst Falls Wisteria - Staked",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001224.070.1",
    "locationcode": "F.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Amethyst Falls Wisteria Espalier",
    "contsize": "#7",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001224.070.1",
    "locationcode": "J.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Amethyst Falls Wisteria Espalier",
    "contsize": "#7",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002190.050.1",
    "locationcode": "F.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Amethyst Falls Wisteria Ladder",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002190.050.1",
    "locationcode": "J.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Amethyst Falls Wisteria Ladder",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004853.011.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Asian Moon Butterfly Bush",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004853.011.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Asian Moon Butterfly Bush",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004853.021.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Asian Moon Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004853.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Asian Moon Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004853.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Asian Moon Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011364.070.1",
    "locationcode": "A.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Barbara Ann Climbing Hydrangea Espalier",
    "contsize": "#7",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011364.070.1",
    "locationcode": "F.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Barbara Ann Climbing Hydrangea Espalier",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011363.050.1",
    "locationcode": "A.06.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Barbara Ann Climbing Hydrangea Ladder",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011363.050.1",
    "locationcode": "A.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Barbara Ann Climbing Hydrangea Ladder",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011363.050.1",
    "locationcode": "D.32.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Barbara Ann Climbing Hydrangea Ladder",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010348.021.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Birthday Cake\u2122 Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001672.010.1",
    "locationcode": "C.16.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Black Knight Butterfly Bush",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001672.010.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Black Knight Butterfly Bush",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001672.020.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Black Knight Butterfly Bush",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001672.020.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Black Knight Butterfly Bush",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001672.030.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Black Knight Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001672.030.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Black Knight Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001672.030.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Black Knight Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001672.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Black Knight Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006794.031.1",
    "locationcode": "E.06.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Black Tower Elderberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006794.031.1",
    "locationcode": "F.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Black Tower Elderberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004227.011.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Heaven Butterfly Bush",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004227.021.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Heaven Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004227.021.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Heaven Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004227.031.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Heaven Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004227.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Heaven Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004227.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Heaven Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004227.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Heaven Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002226.020.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Moon Wisteria - Staked",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002226.020.1",
    "locationcode": "D.23.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Moon Wisteria - Staked",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002226.030.1",
    "locationcode": "D.23.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Moon Wisteria - Staked",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002226.030.1",
    "locationcode": "F.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Moon Wisteria - Staked",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002226.030.1",
    "locationcode": "G.01.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Moon Wisteria - Staked",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002226.030.1",
    "locationcode": "J.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Moon Wisteria - Staked",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011290.070.1",
    "locationcode": "F.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Moon Wisteria Espalier",
    "contsize": "#7",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004666.050.1",
    "locationcode": "G.01.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Moon Wisteria Ladder",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004666.050.1",
    "locationcode": "J.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Moon Wisteria Ladder",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002655.030.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Velvet\u2122 St. Johnswort",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002655.030.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Velvet\u2122 St. Johnswort",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002655.030.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Velvet\u2122 St. Johnswort",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002655.030.1",
    "locationcode": "F.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Velvet\u2122 St. Johnswort",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002655.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blue Velvet\u2122 St. Johnswort",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010347.021.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blueberry Pie\u2122 Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010347.021.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blueberry Pie\u2122 Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010347.021.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Blueberry Pie\u2122 Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001584.010.1",
    "locationcode": "B.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Bonanza Gold\u00ae Barberry",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001584.010.1",
    "locationcode": "G.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Bonanza Gold\u00ae Barberry",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001584.020.1",
    "locationcode": "G.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Bonanza Gold\u00ae Barberry",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001584.020.1",
    "locationcode": "G.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Bonanza Gold\u00ae Barberry",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001584.030.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Bonanza Gold\u00ae Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001584.030.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Bonanza Gold\u00ae Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001584.030.1",
    "locationcode": "F.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Bonanza Gold\u00ae Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001584.030.1",
    "locationcode": "G.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Bonanza Gold\u00ae Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010512.031.1",
    "locationcode": "C.16.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Bubbly Wine\u2122 Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010512.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Bubbly Wine\u2122 Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009054.031.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Butterfly Towers\u2122 Magenta Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009054.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Butterfly Towers\u2122 Magenta Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009317.031.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Butterfly Towers\u2122 White Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009317.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Butterfly Towers\u2122 White Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009317.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Butterfly Towers\u2122 White Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000909.020.1",
    "locationcode": "D.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Canyon Creek Abelia",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000909.020.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Canyon Creek Abelia",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000909.020.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Canyon Creek Abelia",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000909.020.1",
    "locationcode": "E.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Canyon Creek Abelia",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000909.030.1",
    "locationcode": "D.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Canyon Creek Abelia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000909.030.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Canyon Creek Abelia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000909.030.1",
    "locationcode": "F.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Canyon Creek Abelia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000909.030.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Canyon Creek Abelia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004110.030.1",
    "locationcode": "D.11.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Centre Court\u2122 Cherry Laurel",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004110.030.1",
    "locationcode": "F.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Centre Court\u2122 Cherry Laurel",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004110.070.1",
    "locationcode": "I.05.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Centre Court\u2122 Cherry Laurel",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004110.150.1",
    "locationcode": "C.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Centre Court\u2122 Cherry Laurel",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004110.250.1",
    "locationcode": "A.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Centre Court\u2122 Cherry Laurel",
    "contsize": "#25",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004110.250.1",
    "locationcode": "C.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Centre Court\u2122 Cherry Laurel",
    "contsize": "#25",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005201.030.1",
    "locationcode": "F.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Centre Court\u2122Cherry Laurel Tree Form",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001337.031.1",
    "locationcode": "A.05.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chardonnay Pearls\u00ae Deutzia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001337.031.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chardonnay Pearls\u00ae Deutzia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001337.031.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chardonnay Pearls\u00ae Deutzia",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001337.031.1",
    "locationcode": "E.06.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chardonnay Pearls\u00ae Deutzia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001337.031.1",
    "locationcode": "F.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chardonnay Pearls\u00ae Deutzia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001337.031.1",
    "locationcode": "F.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chardonnay Pearls\u00ae Deutzia",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001337.081.1",
    "locationcode": "A.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chardonnay Pearls\u00ae Deutzia",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001337.081.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chardonnay Pearls\u00ae Deutzia",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010225.010.1",
    "locationcode": "D.08.044",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chrysalis\u2122 Blue Butterfly Bush",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010224.010.1",
    "locationcode": "D.07.002",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chrysalis\u2122 Cranberry Butterfly Bush",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010224.010.1",
    "locationcode": "D.08.044",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chrysalis\u2122 Cranberry Butterfly Bush",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010226.010.1",
    "locationcode": "D.08.044",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chrysalis\u2122 Pink Butterfly Bush",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010223.010.1",
    "locationcode": "D.07.002",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chrysalis\u2122 Purple Butterfly Bush",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010223.010.1",
    "locationcode": "D.08.044",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chrysalis\u2122 Purple Butterfly Bush",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010222.010.1",
    "locationcode": "D.07.002",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chrysalis\u2122 White Butterfly Bush",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010222.010.1",
    "locationcode": "D.08.021",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chrysalis\u2122 White Butterfly Bush",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006489.021.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Cobalt-N-Gold\u2122 St. Johnswort",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006489.021.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Cobalt-N-Gold\u2122 St. Johnswort",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006489.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Cobalt-N-Gold\u2122 St. Johnswort",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006489.031.1",
    "locationcode": "F.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Cobalt-N-Gold\u2122 St. Johnswort",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006489.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Cobalt-N-Gold\u2122 St. Johnswort",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001602.010.1",
    "locationcode": "D.28.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Compact Crimson Pygmy Barberry",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001602.010.1",
    "locationcode": "D.31.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Compact Crimson Pygmy Barberry",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001602.010.1",
    "locationcode": "G.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Compact Crimson Pygmy Barberry",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001602.010.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Compact Crimson Pygmy Barberry",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001602.010.1",
    "locationcode": "H.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Compact Crimson Pygmy Barberry",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001602.020.1",
    "locationcode": "D.28.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Compact Crimson Pygmy Barberry",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001602.020.1",
    "locationcode": "G.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Compact Crimson Pygmy Barberry",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001602.020.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Compact Crimson Pygmy Barberry",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001602.030.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Compact Crimson Pygmy Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001602.030.1",
    "locationcode": "D.33.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Compact Crimson Pygmy Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001602.030.1",
    "locationcode": "F.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Compact Crimson Pygmy Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001602.030.1",
    "locationcode": "G.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Compact Crimson Pygmy Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001602.030.1",
    "locationcode": "H.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Compact Crimson Pygmy Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001545.020.1",
    "locationcode": "D.28.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Concorde Barberry",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001545.020.1",
    "locationcode": "G.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Concorde Barberry",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001545.020.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Concorde Barberry",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001545.030.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Concorde Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001545.030.1",
    "locationcode": "F.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Concorde Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001545.030.1",
    "locationcode": "H.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Concorde Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007409.031.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Cranrazz Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007409.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Cranrazz Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007409.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Cranrazz Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010059.030.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dapper\u00ae Lavender Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010059.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dapper\u00ae Lavender Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010790.030.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dapper\u00ae Pink Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010790.030.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dapper\u00ae Pink Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010790.030.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dapper\u00ae Pink Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010053.030.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dapper\u00ae White Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010053.030.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dapper\u00ae White Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010053.030.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dapper\u00ae White Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000309.010.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dark Horse Weigela",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000309.010.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dark Horse Weigela",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000309.010.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dark Horse Weigela",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000309.010.1",
    "locationcode": "H.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dark Horse Weigela",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000309.020.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dark Horse Weigela",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000309.020.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dark Horse Weigela",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000309.020.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dark Horse Weigela",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000309.030.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dark Horse Weigela",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000309.030.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dark Horse Weigela",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000309.030.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dark Horse Weigela",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000309.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dark Horse Weigela",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011103.020.1",
    "locationcode": "D.08.064",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Dr. Ruppel Clematis Ladder",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008391.021.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Electric Love\u00ae Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008391.021.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Electric Love\u00ae Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008391.021.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Electric Love\u00ae Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005675.030.1",
    "locationcode": "E.01.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Everbrite\u2122 Cherry Laurel",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005675.030.1",
    "locationcode": "E.23.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Everbrite\u2122 Cherry Laurel",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005675.030.1",
    "locationcode": "F.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Everbrite\u2122 Cherry Laurel",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005675.070.1",
    "locationcode": "F.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Everbrite\u2122 Cherry Laurel",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005675.070.1",
    "locationcode": "H.05.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Everbrite\u2122 Cherry Laurel",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005675.150.1",
    "locationcode": "C.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Everbrite\u2122 Cherry Laurel",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005675.150.1",
    "locationcode": "D.32.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Everbrite\u2122 Cherry Laurel",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005675.150.1",
    "locationcode": "F.06.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Everbrite\u2122 Cherry Laurel",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005675.150.1",
    "locationcode": "F.11.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Everbrite\u2122 Cherry Laurel",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005675.150.2",
    "locationcode": "F.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Everbrite\u2122 Cherry Laurel",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005675.250.1",
    "locationcode": "A.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Everbrite\u2122 Cherry Laurel",
    "contsize": "#25",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010811.030.1",
    "locationcode": "E.01.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Everbrite\u2122 Cherry Laurel Tree Form",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010621.021.1",
    "locationcode": "D.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Firefly\u00ae Bush Honeysuckle",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010621.021.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Firefly\u00ae Bush Honeysuckle",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010621.021.1",
    "locationcode": "E.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Firefly\u00ae Bush Honeysuckle",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010621.031.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Firefly\u00ae Bush Honeysuckle",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010621.031.1",
    "locationcode": "F.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Firefly\u00ae Bush Honeysuckle",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011198.021.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "First Editions\u00ae Funky Fuchsia\u2122 Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011197.021.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "First Editions\u00ae Groovy Grape\u2122 Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011196.021.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "First Editions\u00ae Trippy Pink\u2122 Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002027.031.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Fourth of July Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002027.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Fourth of July Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000761.020.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "French Lace\u2122 Weigela",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011104.020.1",
    "locationcode": "D.08.064",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Gillian Blades Clematis Ladder",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001020.030.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Glossy Abelia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001020.030.1",
    "locationcode": "D.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Glossy Abelia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001020.030.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Glossy Abelia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001620.010.1",
    "locationcode": "B.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Barberry",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001620.010.1",
    "locationcode": "G.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Barberry",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001620.020.1",
    "locationcode": "B.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Barberry",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001620.020.1",
    "locationcode": "D.13.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Barberry",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001620.020.1",
    "locationcode": "G.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Barberry",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001620.030.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001620.030.1",
    "locationcode": "F.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001620.030.1",
    "locationcode": "G.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003186.011.1",
    "locationcode": "B.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Rocket Barberry",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003186.011.1",
    "locationcode": "D.13.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Rocket Barberry",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003186.011.1",
    "locationcode": "G.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Rocket Barberry",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003186.031.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Rocket Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003186.031.1",
    "locationcode": "F.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Rocket Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003186.031.1",
    "locationcode": "H.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Rocket Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004400.010.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Goldflame Honeysuckle",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004400.010.1",
    "locationcode": "J.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Goldflame Honeysuckle",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004400.020.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Goldflame Honeysuckle",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004400.030.1",
    "locationcode": "F.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Goldflame Honeysuckle",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004400.030.1",
    "locationcode": "G.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Goldflame Honeysuckle",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004415.010.1",
    "locationcode": "C.16.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Hall's Honeysuckle",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004415.010.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Hall's Honeysuckle",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004415.010.1",
    "locationcode": "J.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Hall's Honeysuckle",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004415.030.1",
    "locationcode": "G.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Hall's Honeysuckle",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004415.030.1",
    "locationcode": "G.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Hall's Honeysuckle",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004415.030.1",
    "locationcode": "J.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Hall's Honeysuckle",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001686.030.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Honeycomb Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010748.020.1",
    "locationcode": "D.08.063",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Jackmanii Clematis Ladder",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001993.010.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kaleidoscope Abelia",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001993.011.1",
    "locationcode": "E.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kaleidoscope Abelia",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001993.021.1",
    "locationcode": "D.13.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kaleidoscope Abelia",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001993.021.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kaleidoscope Abelia",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001993.021.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kaleidoscope Abelia",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001993.031.1",
    "locationcode": "B.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kaleidoscope Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001993.031.1",
    "locationcode": "C.11.008",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kaleidoscope Abelia",
    "contsize": "3DP",
    "source": "TX"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001993.031.1",
    "locationcode": "C.11.009",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kaleidoscope Abelia",
    "contsize": "3DP",
    "source": "TX"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001993.031.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kaleidoscope Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001993.031.1",
    "locationcode": "D.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kaleidoscope Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001993.031.1",
    "locationcode": "E.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kaleidoscope Abelia",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001993.031.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kaleidoscope Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001993.031.1",
    "locationcode": "H.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kaleidoscope Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005277.031.1",
    "locationcode": "F.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kintzley's Ghost\u00ae Honeysuckle",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005277.031.1",
    "locationcode": "I.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kintzley's Ghost\u00ae Honeysuckle",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010692.031.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kodiak Fresh\u00ae Bush Honeysuckle",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010692.031.1",
    "locationcode": "F.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kodiak Fresh\u00ae Bush Honeysuckle",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010692.031.1",
    "locationcode": "F.15.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kodiak Fresh\u00ae Bush Honeysuckle",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011064.031.1",
    "locationcode": "A.05.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kodiak Jet Black\u2122 Bush Honeysuckle",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011064.031.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kodiak Jet Black\u2122 Bush Honeysuckle",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011064.031.1",
    "locationcode": "F.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kodiak Jet Black\u2122 Bush Honeysuckle",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007361.021.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kodiak\u00ae Black Bush Honeysuckle",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007361.021.1",
    "locationcode": "E.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kodiak\u00ae Black Bush Honeysuckle",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007361.031.1",
    "locationcode": "C.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kodiak\u00ae Black Bush Honeysuckle",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007361.031.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kodiak\u00ae Black Bush Honeysuckle",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007361.031.1",
    "locationcode": "F.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kodiak\u00ae Black Bush Honeysuckle",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011230.031.1",
    "locationcode": "B.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kodiak\u00ae Red 2.0 Bush Honeysuckle",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011230.031.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kodiak\u00ae Red 2.0 Bush Honeysuckle",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011230.031.1",
    "locationcode": "F.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kodiak\u00ae Red 2.0 Bush Honeysuckle",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007685.031.1",
    "locationcode": "A.05.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kodiak\u00ae Red Bush Honeysuckle",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007685.031.1",
    "locationcode": "B.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kodiak\u00ae Red Bush Honeysuckle",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007685.031.1",
    "locationcode": "F.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Kodiak\u00ae Red Bush Honeysuckle",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003452.070.1",
    "locationcode": "G.01.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lavender Falls Wisteria Espalier",
    "contsize": "#7",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003453.051.1",
    "locationcode": "F.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lavender Falls Wisteria Ladder",
    "contsize": "5DP",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003453.051.1",
    "locationcode": "G.01.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lavender Falls Wisteria Ladder",
    "contsize": "5DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003453.051.1",
    "locationcode": "J.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lavender Falls Wisteria Ladder",
    "contsize": "5DP",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003132.011.1",
    "locationcode": "D.23.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lavender Falls Wisteria Staked",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003132.011.1",
    "locationcode": "J.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lavender Falls Wisteria Staked",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003132.031.1",
    "locationcode": "D.23.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lavender Falls Wisteria Staked",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003132.031.1",
    "locationcode": "G.01.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lavender Falls Wisteria Staked",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003132.031.1",
    "locationcode": "J.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lavender Falls Wisteria Staked",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008563.021.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lo & Behold Ruby Chip\u00ae Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008563.021.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lo & Behold Ruby Chip\u00ae Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008563.021.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lo & Behold Ruby Chip\u00ae Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008563.031.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lo & Behold Ruby Chip\u00ae Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008563.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lo & Behold Ruby Chip\u00ae Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005102.031.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lo & Behold\u00ae Purple Haze Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005102.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lo & Behold\u00ae Purple Haze Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005102.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lo & Behold\u00ae Purple Haze Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005102.031.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lo & Behold\u00ae Purple Haze Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005102.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lo & Behold\u00ae Purple Haze Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005102.081.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Lo & Behold\u00ae Purple Haze Butterfly Bush",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002602.070.1",
    "locationcode": "F.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Manhattan Euonymus Espalier",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002602.070.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Manhattan Euonymus Espalier",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008389.021.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Maroon Swoon\u00ae Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008389.021.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Maroon Swoon\u00ae Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010174.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Midnight Sun\u2122 Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010174.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Midnight Sun\u2122 Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010174.081.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Midnight Sun\u2122 Weigela",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010174.081.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Midnight Sun\u2122 Weigela",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006817.031.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Midnight Wine Shine\u00ae Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006817.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Midnight Wine Shine\u00ae Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006817.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Midnight Wine Shine\u00ae Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006817.081.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Midnight Wine Shine\u00ae Weigela",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006817.081.1",
    "locationcode": "I.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Midnight Wine Shine\u00ae Weigela",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011259.021.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Milky Way\u2122 Abelia",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011259.021.1",
    "locationcode": "D.33.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Milky Way\u2122 Abelia",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011259.021.1",
    "locationcode": "E.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Milky Way\u2122 Abelia",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011259.031.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Milky Way\u2122 Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011259.031.1",
    "locationcode": "G.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Milky Way\u2122 Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006995.010.1",
    "locationcode": "C.16.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Minuet Weigela",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006995.020.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Minuet Weigela",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006995.020.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Minuet Weigela",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006995.030.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Minuet Weigela",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006995.030.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Minuet Weigela",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006995.030.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Minuet Weigela",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006995.030.1",
    "locationcode": "I.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Minuet Weigela",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005104.021.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Miss Molly Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005104.021.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Miss Molly Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005104.031.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Miss Molly Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005104.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Miss Molly Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005104.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Miss Molly Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005104.081.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Miss Molly Butterfly Bush",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007887.021.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Miss Violet Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007887.021.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Miss Violet Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007887.021.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Miss Violet Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007887.031.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Miss Violet Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007887.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Miss Violet Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007887.081.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Miss Violet Butterfly Bush",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007887.081.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Miss Violet Butterfly Bush",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007887.081.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Miss Violet Butterfly Bush",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005380.050.1",
    "locationcode": "I.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Mohave Pyracantha Staked",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011280.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Mop Top\u2122 Fountain Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011280.031.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Mop Top\u2122 Fountain Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006612.031.1",
    "locationcode": "E.06.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Morden Golden Glow Elderberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006612.031.1",
    "locationcode": "F.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Morden Golden Glow Elderberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010678.031.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Mucho Gusto\u2122 Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010678.031.1",
    "locationcode": "E.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Mucho Gusto\u2122 Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010678.031.1",
    "locationcode": "E.06.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Mucho Gusto\u2122 Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011271.030.1",
    "locationcode": "A.05.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "N/S Sundrop Abelia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001666.010.1",
    "locationcode": "C.16.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nanho Blue Butterfly Bush",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001666.010.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nanho Blue Butterfly Bush",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001666.020.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nanho Blue Butterfly Bush",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001666.020.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nanho Blue Butterfly Bush",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001666.030.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nanho Blue Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001666.030.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nanho Blue Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001667.010.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nanho Purple Butterfly Bush",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001667.020.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nanho Purple Butterfly Bush",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001667.020.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nanho Purple Butterfly Bush",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001667.030.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nanho Purple Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001667.030.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nanho Purple Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001667.030.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nanho Purple Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008378.021.1",
    "locationcode": "D.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nightglow\u00ae Bush Honeysuckle",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008378.021.1",
    "locationcode": "E.06.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nightglow\u00ae Bush Honeysuckle",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008378.021.1",
    "locationcode": "G.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nightglow\u00ae Bush Honeysuckle",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002081.010.1",
    "locationcode": "C.16.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nikko Slender Deutzia",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002081.020.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nikko Slender Deutzia",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002081.030.1",
    "locationcode": "C.16.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nikko Slender Deutzia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002081.030.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nikko Slender Deutzia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002081.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Nikko Slender Deutzia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002780.011.1",
    "locationcode": "D.28.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Orange Rocket Barberry",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002780.011.1",
    "locationcode": "D.31.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Orange Rocket Barberry",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002780.011.1",
    "locationcode": "G.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Orange Rocket Barberry",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002780.011.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Orange Rocket Barberry",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002780.011.1",
    "locationcode": "H.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Orange Rocket Barberry",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002780.021.1",
    "locationcode": "D.28.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Orange Rocket Barberry",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002780.021.1",
    "locationcode": "G.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Orange Rocket Barberry",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002780.031.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Orange Rocket Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002780.031.1",
    "locationcode": "F.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Orange Rocket Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002780.031.1",
    "locationcode": "H.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Orange Rocket Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004819.030.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Orange Sceptre Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009727.021.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Peach Kisses\u2122 Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009727.021.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Peach Kisses\u2122 Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007683.031.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pearl Glam\u00ae Beautyberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007683.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pearl Glam\u00ae Beautyberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007683.031.1",
    "locationcode": "F.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pearl Glam\u00ae Beautyberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007683.031.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pearl Glam\u00ae Beautyberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007683.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pearl Glam\u00ae Beautyberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001060.010.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pink Abelia",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001060.030.1",
    "locationcode": "A.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pink Abelia",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001060.030.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pink Abelia",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001060.030.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pink Abelia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001060.030.1",
    "locationcode": "E.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pink Abelia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001668.010.1",
    "locationcode": "C.16.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pink Delight Butterfly Bush",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001668.010.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pink Delight Butterfly Bush",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001668.020.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pink Delight Butterfly Bush",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001668.030.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pink Delight Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001668.030.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pink Delight Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001668.030.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pink Delight Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001668.030.1",
    "locationcode": "H.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pink Delight Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006609.021.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Polar Flare\u2122 Bush Honeysuckle",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006609.021.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Polar Flare\u2122 Bush Honeysuckle",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006609.021.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Polar Flare\u2122 Bush Honeysuckle",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006609.021.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Polar Flare\u2122 Bush Honeysuckle",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006999.010.1",
    "locationcode": "C.16.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Polka Weigela",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008034.021.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Blue\u00ae Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008034.021.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Blue\u00ae Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008034.021.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Blue\u00ae Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008034.031.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Blue\u00ae Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008034.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Blue\u00ae Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008034.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Blue\u00ae Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008034.081.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Blue\u00ae Butterfly Bush",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008034.081.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Blue\u00ae Butterfly Bush",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008035.021.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Periwinkle\u00ae Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008035.021.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Periwinkle\u00ae Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008035.021.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Periwinkle\u00ae Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008035.031.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Periwinkle\u00ae Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008035.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Periwinkle\u00ae Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008035.031.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Periwinkle\u00ae Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008035.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Periwinkle\u00ae Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008035.081.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Periwinkle\u00ae Butterfly Bush",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008035.081.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Periwinkle\u00ae Butterfly Bush",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009341.021.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Pinker\u00ae Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009341.031.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Pinker\u00ae Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009341.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Pinker\u00ae Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009341.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Pinker\u00ae Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009341.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Pinker\u00ae Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009341.081.1",
    "locationcode": "D.09.014",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Pinker\u00ae Butterfly Bush",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009341.081.1",
    "locationcode": "D.09.028",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Pinker\u00ae Butterfly Bush",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009341.081.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Pinker\u00ae Butterfly Bush",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009341.081.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster Pinker\u00ae Butterfly Bush",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008148.021.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster White\u00ae Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008148.021.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster White\u00ae Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008148.031.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster White\u00ae Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008148.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster White\u00ae Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008148.081.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster White\u00ae Butterfly Bush",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008125.021.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster\u00ae Amethyst Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008125.021.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster\u00ae Amethyst Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008125.021.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster\u00ae Amethyst Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008125.021.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster\u00ae Amethyst Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008125.031.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster\u00ae Amethyst Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008125.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster\u00ae Amethyst Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008125.031.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster\u00ae Amethyst Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008125.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster\u00ae Amethyst Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008125.081.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster\u00ae Amethyst Butterfly Bush",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008125.081.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster\u00ae Amethyst Butterfly Bush",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008125.081.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Pugster\u00ae Amethyst Butterfly Bush",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004420.030.1",
    "locationcode": "J.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Purple Leaf Honeysuckle",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001711.030.1",
    "locationcode": "D.23.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Purple Pride Beautyberry",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001711.030.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Purple Pride Beautyberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001711.030.1",
    "locationcode": "F.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Purple Pride Beautyberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001711.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Purple Pride Beautyberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001711.030.1",
    "locationcode": "I.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Purple Pride Beautyberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001711.070.1",
    "locationcode": "F.05.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Purple Pride Beautyberry",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001711.070.1",
    "locationcode": "G.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Purple Pride Beautyberry",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007358.021.1",
    "locationcode": "B.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Radiance Abelia",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007358.021.1",
    "locationcode": "D.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Radiance Abelia",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007358.021.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Radiance Abelia",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007358.031.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Radiance Abelia",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007358.031.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Radiance Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007358.031.1",
    "locationcode": "E.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Radiance Abelia",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007358.031.1",
    "locationcode": "F.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Radiance Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009287.031.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Ramblin' Man\u00ae Weeping Holly Staked",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009287.031.1",
    "locationcode": "I.06.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Ramblin' Man\u00ae Weeping Holly Staked",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009287.070.1",
    "locationcode": "G.11.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Ramblin' Man\u00ae Weeping Holly Staked",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009287.070.1",
    "locationcode": "I.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Ramblin' Man\u00ae Weeping Holly Staked",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009287.070.2",
    "locationcode": "G.11.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Ramblin' Man\u00ae Weeping Holly Staked",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007010.010.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Red Prince Weigela",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007010.020.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Red Prince Weigela",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007010.020.1",
    "locationcode": "D.23.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Red Prince Weigela",
    "contsize": "#2",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007010.020.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Red Prince Weigela",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007010.030.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Red Prince Weigela",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007010.030.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Red Prince Weigela",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007010.030.1",
    "locationcode": "I.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Red Prince Weigela",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001030.020.1",
    "locationcode": "B.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Rose Creek Abelia",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001030.020.1",
    "locationcode": "D.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Rose Creek Abelia",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001030.020.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Rose Creek Abelia",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001030.020.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Rose Creek Abelia",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001030.030.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Rose Creek Abelia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001030.030.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Rose Creek Abelia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001030.030.1",
    "locationcode": "E.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Rose Creek Abelia",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001640.010.1",
    "locationcode": "D.28.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Rosy Glow Barberry",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001640.010.1",
    "locationcode": "D.31.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Rosy Glow Barberry",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001640.010.1",
    "locationcode": "G.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Rosy Glow Barberry",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001640.010.1",
    "locationcode": "H.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Rosy Glow Barberry",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001640.020.1",
    "locationcode": "D.28.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Rosy Glow Barberry",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001640.020.1",
    "locationcode": "G.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Rosy Glow Barberry",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001640.020.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Rosy Glow Barberry",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001640.030.1",
    "locationcode": "F.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Rosy Glow Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001640.030.1",
    "locationcode": "H.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Rosy Glow Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011476.020.1",
    "locationcode": "D.08.001",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Rouge Cardinal Clematis Ladder",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011476.020.1",
    "locationcode": "D.08.064",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Rouge Cardinal Clematis Ladder",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001555.010.1",
    "locationcode": "D.28.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Royal Burgundy\u00ae Barberry",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001555.010.1",
    "locationcode": "G.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Royal Burgundy\u00ae Barberry",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001555.010.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Royal Burgundy\u00ae Barberry",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001555.020.1",
    "locationcode": "D.28.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Royal Burgundy\u00ae Barberry",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001555.020.1",
    "locationcode": "G.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Royal Burgundy\u00ae Barberry",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001555.020.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Royal Burgundy\u00ae Barberry",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001555.030.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Royal Burgundy\u00ae Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001555.030.1",
    "locationcode": "F.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Royal Burgundy\u00ae Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001555.030.1",
    "locationcode": "H.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Royal Burgundy\u00ae Barberry",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001669.010.1",
    "locationcode": "C.16.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Royal Red Butterfly Bush",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001669.010.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Royal Red Butterfly Bush",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001669.020.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Royal Red Butterfly Bush",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001669.020.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Royal Red Butterfly Bush",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001669.030.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Royal Red Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001669.030.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Royal Red Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001669.030.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Royal Red Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003677.021.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Shining Sensation\u2122 Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003677.021.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Shining Sensation\u2122 Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003677.021.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Shining Sensation\u2122 Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003677.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Shining Sensation\u2122 Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003563.030.1",
    "locationcode": "I.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Silver Lining\u2122 Variegated Pyracantha Espalier",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003563.070.1",
    "locationcode": "F.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Silver Lining\u2122 Variegated Pyracantha Espalier",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010686.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sonic Bloom Wine\u2122 Reblooming Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010686.031.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sonic Bloom Wine\u2122 Reblooming Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010686.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sonic Bloom Wine\u2122 Reblooming Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010686.081.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sonic Bloom Wine\u2122 Reblooming Weigela",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010686.081.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sonic Bloom Wine\u2122 Reblooming Weigela",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005762.031.1",
    "locationcode": "A.06.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sonic Bloom\u00ae Pink Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005762.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sonic Bloom\u00ae Pink Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005762.031.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sonic Bloom\u00ae Pink Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005762.031.1",
    "locationcode": "I.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sonic Bloom\u00ae Pink Weigela",
    "contsize": "3DP",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005762.081.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sonic Bloom\u00ae Pink Weigela",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005687.031.1",
    "locationcode": "A.06.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sonic Bloom\u00ae Red Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005687.031.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sonic Bloom\u00ae Red Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005687.031.1",
    "locationcode": "I.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sonic Bloom\u00ae Red Weigela",
    "contsize": "3DP",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005687.031.1",
    "locationcode": "I.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sonic Bloom\u00ae Red Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005687.081.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sonic Bloom\u00ae Red Weigela",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005687.081.1",
    "locationcode": "I.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sonic Bloom\u00ae Red Weigela",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005107.021.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Spilled Wine\u00ae Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005107.021.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Spilled Wine\u00ae Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005107.021.1",
    "locationcode": "F.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Spilled Wine\u00ae Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005107.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Spilled Wine\u00ae Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005107.031.1",
    "locationcode": "G.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Spilled Wine\u00ae Weigela",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005107.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Spilled Wine\u00ae Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005107.081.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Spilled Wine\u00ae Weigela",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005107.081.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Spilled Wine\u00ae Weigela",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005107.081.1",
    "locationcode": "F.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Spilled Wine\u00ae Weigela",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005107.081.1",
    "locationcode": "I.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Spilled Wine\u00ae Weigela",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008387.021.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Stunner\u00ae Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008387.021.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Stunner\u00ae Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008387.021.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Stunner\u00ae Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000751.030.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunburst St. Johnswort",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000751.030.1",
    "locationcode": "F.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunburst St. Johnswort",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000751.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunburst St. Johnswort",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011068.031.1",
    "locationcode": "H.11.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunjoy Fast Neo\u2122 Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004612.021.1",
    "locationcode": "B.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunjoy Gold Pillar\u00ae Barberry",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004612.021.1",
    "locationcode": "G.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunjoy Gold Pillar\u00ae Barberry",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004612.031.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunjoy Gold Pillar\u00ae Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004612.031.1",
    "locationcode": "D.13.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunjoy Gold Pillar\u00ae Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004612.031.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunjoy Gold Pillar\u00ae Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004612.031.1",
    "locationcode": "F.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunjoy Gold Pillar\u00ae Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004612.031.1",
    "locationcode": "H.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunjoy Gold Pillar\u00ae Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004612.081.1",
    "locationcode": "B.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunjoy Gold Pillar\u00ae Barberry",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008562.021.1",
    "locationcode": "A.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunjoy Neo\u00ae Barberry",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008562.021.1",
    "locationcode": "E.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunjoy Neo\u00ae Barberry",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011186.031.1",
    "locationcode": "F.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunjoy Orange Pillar\u00ae Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011069.031.1",
    "locationcode": "H.11.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunjoy Really Red\u2122 Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010175.021.1",
    "locationcode": "B.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunjoy\u00ae Citrus Barberry",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010175.021.1",
    "locationcode": "G.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunjoy\u00ae Citrus Barberry",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010175.031.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunjoy\u00ae Citrus Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010175.031.1",
    "locationcode": "F.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunjoy\u00ae Citrus Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010175.031.1",
    "locationcode": "H.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Sunjoy\u00ae Citrus Barberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008403.021.1",
    "locationcode": "A.06.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Thunderbolt\u00ae Box Honeysuckle",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008403.021.1",
    "locationcode": "D.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Thunderbolt\u00ae Box Honeysuckle",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008403.021.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Thunderbolt\u00ae Box Honeysuckle",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008403.021.1",
    "locationcode": "E.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Thunderbolt\u00ae Box Honeysuckle",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003188.011.1",
    "locationcode": "B.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Tiny Gold Barberry",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003188.011.1",
    "locationcode": "G.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Tiny Gold Barberry",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003188.021.1",
    "locationcode": "B.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Tiny Gold Barberry",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003188.021.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Tiny Gold Barberry",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003188.021.1",
    "locationcode": "G.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Tiny Gold Barberry",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001372.010.1",
    "locationcode": "C.16.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Trumpet (Coral) Honeysuckle Bush",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001372.030.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Trumpet (Coral) Honeysuckle Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001372.030.1",
    "locationcode": "I.13.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Trumpet (Coral) Honeysuckle Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004229.011.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Tutti Fruitti Butterfly Bush",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004229.011.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Tutti Fruitti Butterfly Bush",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004229.011.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Tutti Fruitti Butterfly Bush",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004229.021.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Tutti Fruitti Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004229.021.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Tutti Fruitti Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004229.021.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Tutti Fruitti Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004229.031.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Tutti Fruitti Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004229.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Tutti Fruitti Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004229.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Tutti Fruitti Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007429.031.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Twist of Lemon\u2122 Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007429.031.1",
    "locationcode": "D.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Twist of Lemon\u2122 Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007429.031.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Twist of Lemon\u2122 Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003152.031.1",
    "locationcode": "C.11.025",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Twist of Lime\u2122 Abelia",
    "contsize": "3DP",
    "source": "TX"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003152.031.1",
    "locationcode": "C.11.054",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Twist of Lime\u2122 Abelia",
    "contsize": "3DP",
    "source": "TX"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005818.031.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Twist of Orange\u2122 Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005818.031.1",
    "locationcode": "D.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Twist of Orange\u2122 Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005818.031.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Twist of Orange\u2122 Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007379.031.1",
    "locationcode": "D.13.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Twist of Vanilla\u2122 Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007379.031.1",
    "locationcode": "F.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Twist of Vanilla\u2122 Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007379.031.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Twist of Vanilla\u2122 Abelia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006116.021.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Vanilla Treat\u2122 Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006116.021.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Vanilla Treat\u2122 Butterfly Bush",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006116.031.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Vanilla Treat\u2122 Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006116.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Vanilla Treat\u2122 Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006116.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Vanilla Treat\u2122 Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007050.010.1",
    "locationcode": "C.16.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Variegated Dwarf Weigela",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007050.010.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Variegated Dwarf Weigela",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007050.020.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Variegated Dwarf Weigela",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007050.020.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Variegated Dwarf Weigela",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007050.030.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Variegated Dwarf Weigela",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007050.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Variegated Dwarf Weigela",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009354.031.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Very Fine Wine\u00ae Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009354.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Very Fine Wine\u00ae Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009354.031.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Very Fine Wine\u00ae Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009354.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Very Fine Wine\u00ae Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010750.020.1",
    "locationcode": "D.08.003",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Westerplatte Clematis Ladder",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010750.020.1",
    "locationcode": "D.08.060",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Westerplatte Clematis Ladder",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001670.030.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "White Profusion Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001670.030.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "White Profusion Butterfly Bush",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006895.031.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Windy Hill Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006895.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Windy Hill Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006895.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Windy Hill Butterfly Bush",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007025.021.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wine & Roses\u00ae Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007025.021.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wine & Roses\u00ae Weigela",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007025.031.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wine & Roses\u00ae Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007025.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wine & Roses\u00ae Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007025.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wine & Roses\u00ae Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007025.031.1",
    "locationcode": "I.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wine & Roses\u00ae Weigela",
    "contsize": "3DP",
    "source": "BR"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007025.051.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wine & Roses\u00ae Weigela",
    "contsize": "5DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010176.031.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wine & Spirits\u2122 Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010176.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wine & Spirits\u2122 Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010176.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wine & Spirits\u2122 Weigela",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011498.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Yuki Cherry Blossom\u00ae 2.0 Deutzia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011016.031.1",
    "locationcode": "B.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Yuki Kabuki\u2122 Deutzia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011016.031.1",
    "locationcode": "F.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Yuki Kabuki\u2122 Deutzia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005759.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Yuki Snowflake\u00ae Deutzia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005759.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Yuki Snowflake\u00ae Deutzia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005759.031.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Yuki Snowflake\u00ae Deutzia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005759.031.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Yuki Snowflake\u00ae Deutzia",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005759.081.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Yuki Snowflake\u00ae Deutzia",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002050.020.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "135_ROSES",
    "commonname": "Ramblin' Red\u00ae Climbing Rose Staked",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002050.020.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "135_ROSES",
    "commonname": "Ramblin' Red\u00ae Climbing Rose Staked",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002050.020.1",
    "locationcode": "K.04.000",
    "plantgroupcode": "135_ROSES",
    "commonname": "Ramblin' Red\u00ae Climbing Rose Staked",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002050.050.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "135_ROSES",
    "commonname": "Ramblin' Red\u00ae Climbing Rose Staked",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002050.050.1",
    "locationcode": "I.01.000",
    "plantgroupcode": "135_ROSES",
    "commonname": "Ramblin' Red\u00ae Climbing Rose Staked",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004500.010.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Adagio Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004500.010.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Adagio Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004500.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Adagio Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004500.020.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Adagio Maiden Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004500.020.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Adagio Maiden Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004500.020.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Adagio Maiden Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004500.030.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Adagio Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004500.030.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Adagio Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004500.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Adagio Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011057.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Appalachian Sedge Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000937.030.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Avalanche Variegated Feather Reed Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011132.010.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Berkeley Sedge Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011132.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Berkeley Sedge Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004350.007.1",
    "locationcode": "D.08.028",
    "plantgroupcode": "140_GRASS",
    "commonname": "Big Blue Liriope",
    "contsize": "QT",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004350.010.1",
    "locationcode": "B.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Big Blue Liriope",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004350.010.1",
    "locationcode": "C.09.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Big Blue Liriope",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004350.010.1",
    "locationcode": "C.10.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Big Blue Liriope",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004350.010.1",
    "locationcode": "C.19.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Big Blue Liriope",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004350.010.1",
    "locationcode": "D.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Big Blue Liriope",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004350.010.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Big Blue Liriope",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004350.010.1",
    "locationcode": "E.23.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Big Blue Liriope",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004350.010.1",
    "locationcode": "I.09.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Big Blue Liriope",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004732.030.1",
    "locationcode": "D.05.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Black Flowering Fountain Grass",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003373.007.1",
    "locationcode": "D.08.028",
    "plantgroupcode": "140_GRASS",
    "commonname": "Black Mondo Grass",
    "contsize": "QT",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007702.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blackhawks Big Bluestem",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006192.010.1",
    "locationcode": "C.19.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blonde Ambition Blue Grama Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006192.010.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blonde Ambition Blue Grama Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006192.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blonde Ambition Blue Grama Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006192.010.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blonde Ambition Blue Grama Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007541.031.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blue Bayou Pampas Grass",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007541.031.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blue Bayou Pampas Grass",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007541.031.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blue Bayou Pampas Grass",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007541.051.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blue Bayou Pampas Grass",
    "contsize": "5DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007541.051.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blue Bayou Pampas Grass",
    "contsize": "5DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007541.051.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blue Bayou Pampas Grass",
    "contsize": "5DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004508.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blue Dune Lyme Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004508.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blue Dune Lyme Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004508.010.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blue Dune Lyme Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004508.030.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blue Dune Lyme Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004508.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blue Dune Lyme Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004508.030.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blue Dune Lyme Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004508.030.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blue Dune Lyme Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006755.010.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blue Grama Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006755.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blue Grama Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011557.030.1",
    "locationcode": "E.23.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blue Yonder\u00ae Indian Grass",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008486.010.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blue Zinger Sedge Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008486.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blue Zinger Sedge Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008486.010.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Blue Zinger Sedge Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008533.010.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Chameleon Little Bluestem",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008533.021.1",
    "locationcode": "E.23.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Chameleon Little Bluestem",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008523.011.1",
    "locationcode": "C.09.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Cool as Ice Fescue",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008523.011.1",
    "locationcode": "E.12.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Cool as Ice Fescue",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004104.010.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Corkscrew Juncus",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004104.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Corkscrew Juncus",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004104.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Corkscrew Juncus",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004104.030.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Corkscrew Juncus",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004104.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Corkscrew Juncus",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004104.030.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Corkscrew Juncus",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011215.030.1",
    "locationcode": "D.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Dust in the Wind Switch Grass",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002714.007.1",
    "locationcode": "D.08.030",
    "plantgroupcode": "140_GRASS",
    "commonname": "Elijah Blue Fescue",
    "contsize": "QT",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002714.010.1",
    "locationcode": "E.12.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Elijah Blue Fescue",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007400.007.1",
    "locationcode": "D.08.023",
    "plantgroupcode": "140_GRASS",
    "commonname": "Evercolor\u00ae Everdi Carex",
    "contsize": "QT",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "006274.007.1",
    "locationcode": "D.08.023",
    "plantgroupcode": "140_GRASS",
    "commonname": "Evercolor\u00ae Everest Carex",
    "contsize": "QT",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005950.007.1",
    "locationcode": "D.08.023",
    "plantgroupcode": "140_GRASS",
    "commonname": "Evercolor\u00ae Everillo Carex",
    "contsize": "QT",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005950.011.1",
    "locationcode": "D.08.022",
    "plantgroupcode": "140_GRASS",
    "commonname": "Evercolor\u00ae Everillo Carex",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007401.007.1",
    "locationcode": "D.08.023",
    "plantgroupcode": "140_GRASS",
    "commonname": "Evercolor\u00ae Everlime Carex",
    "contsize": "QT",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007402.007.1",
    "locationcode": "D.08.023",
    "plantgroupcode": "140_GRASS",
    "commonname": "Evercolor\u00ae Eversheen Carex",
    "contsize": "QT",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010364.010.1",
    "locationcode": "D.05.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Feather Falls Carex",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010364.010.1",
    "locationcode": "D.07.032",
    "plantgroupcode": "140_GRASS",
    "commonname": "Feather Falls Carex",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004175.010.1",
    "locationcode": "D.08.058",
    "plantgroupcode": "140_GRASS",
    "commonname": "Fireworks Purple Fountain Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004502.010.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Flame Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004502.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Flame Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004502.010.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Flame Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004502.020.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Flame Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004502.020.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Flame Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004502.020.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Flame Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004502.020.1",
    "locationcode": "J.05.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Flame Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004502.030.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Flame Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004502.030.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Flame Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004502.030.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Flame Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004502.030.1",
    "locationcode": "H.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Flame Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004502.030.1",
    "locationcode": "I.12.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Flame Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004502.030.1",
    "locationcode": "J.05.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Flame Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004729.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Fountain Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004729.010.1",
    "locationcode": "I.09.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Fountain Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004729.020.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Fountain Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004729.020.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Fountain Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004729.030.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Fountain Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004729.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Fountain Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001083.007.1",
    "locationcode": "D.08.030",
    "plantgroupcode": "140_GRASS",
    "commonname": "Golden Variegated Japanese Sweet Flag",
    "contsize": "QT",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001083.010.1",
    "locationcode": "C.09.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Golden Variegated Japanese Sweet Flag",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001083.010.1",
    "locationcode": "C.10.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Golden Variegated Japanese Sweet Flag",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001083.010.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Golden Variegated Japanese Sweet Flag",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004501.010.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Graziella Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004501.010.1",
    "locationcode": "I.09.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Graziella Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004501.030.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Graziella Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004501.030.1",
    "locationcode": "I.12.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Graziella Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004726.007.1",
    "locationcode": "D.08.029",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hameln Dwarf Fountain Grass",
    "contsize": "QT",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004726.010.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hameln Dwarf Fountain Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004726.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hameln Dwarf Fountain Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004726.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hameln Dwarf Fountain Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004726.010.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hameln Dwarf Fountain Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004726.010.1",
    "locationcode": "I.09.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hameln Dwarf Fountain Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004726.020.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hameln Dwarf Fountain Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004726.020.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hameln Dwarf Fountain Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004726.020.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hameln Dwarf Fountain Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004726.020.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hameln Dwarf Fountain Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004726.020.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hameln Dwarf Fountain Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004726.030.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hameln Dwarf Fountain Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004726.030.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hameln Dwarf Fountain Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004726.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hameln Dwarf Fountain Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004726.030.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hameln Dwarf Fountain Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004726.030.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hameln Dwarf Fountain Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004726.050.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hameln Dwarf Fountain Grass",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002210.010.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hardy Pampas Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002210.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hardy Pampas Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002210.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hardy Pampas Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002210.020.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hardy Pampas Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002210.020.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hardy Pampas Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002210.020.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hardy Pampas Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002210.030.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hardy Pampas Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002210.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hardy Pampas Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002210.030.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hardy Pampas Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002210.050.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hardy Pampas Grass",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002210.050.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hardy Pampas Grass",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002210.050.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hardy Pampas Grass",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004496.010.1",
    "locationcode": "C.19.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Heavy Metal Switch Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004496.010.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Heavy Metal Switch Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004496.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Heavy Metal Switch Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004496.020.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Heavy Metal Switch Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004496.020.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Heavy Metal Switch Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004496.030.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Heavy Metal Switch Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004496.030.1",
    "locationcode": "H.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Heavy Metal Switch Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004496.030.1",
    "locationcode": "I.12.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Heavy Metal Switch Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004496.030.1",
    "locationcode": "J.05.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Heavy Metal Switch Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008068.030.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hello Spring!\u2122 Feather Reed Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008068.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hello Spring!\u2122 Feather Reed Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007881.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Hot Rod Switch Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004103.010.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Inflexus Blue Dart Grass Juncus",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004103.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Inflexus Blue Dart Grass Juncus",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004103.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Inflexus Blue Dart Grass Juncus",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004103.020.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Inflexus Blue Dart Grass Juncus",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004103.020.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Inflexus Blue Dart Grass Juncus",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004103.020.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Inflexus Blue Dart Grass Juncus",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000370.010.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Inland Sea Oats",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000370.010.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Inland Sea Oats",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000370.010.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Inland Sea Oats",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000370.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Inland Sea Oats",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000370.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Inland Sea Oats",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000370.030.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Inland Sea Oats",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000370.030.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Inland Sea Oats",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000370.030.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Inland Sea Oats",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000370.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Inland Sea Oats",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000370.030.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Inland Sea Oats",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008521.011.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Jazz Little Bluestem",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008521.011.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Jazz Little Bluestem",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008521.011.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Jazz Little Bluestem",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004148.021.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Jet Streams\u2122 Dwarf Pampas Grass",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004148.021.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Jet Streams\u2122 Dwarf Pampas Grass",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004148.021.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Jet Streams\u2122 Dwarf Pampas Grass",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004148.031.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Jet Streams\u2122 Dwarf Pampas Grass",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004148.031.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Jet Streams\u2122 Dwarf Pampas Grass",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004148.031.1",
    "locationcode": "G.19.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Jet Streams\u2122 Dwarf Pampas Grass",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004148.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Jet Streams\u2122 Dwarf Pampas Grass",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004148.031.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Jet Streams\u2122 Dwarf Pampas Grass",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004148.051.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Jet Streams\u2122 Dwarf Pampas Grass",
    "contsize": "5DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004148.051.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Jet Streams\u2122 Dwarf Pampas Grass",
    "contsize": "5DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004148.051.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Jet Streams\u2122 Dwarf Pampas Grass",
    "contsize": "5DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004148.051.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Jet Streams\u2122 Dwarf Pampas Grass",
    "contsize": "5DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004733.007.1",
    "locationcode": "D.08.030",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karl Foerster Feather Reed Grass",
    "contsize": "QT",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004733.010.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karl Foerster Feather Reed Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004733.010.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karl Foerster Feather Reed Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004733.010.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karl Foerster Feather Reed Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004733.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karl Foerster Feather Reed Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004733.010.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karl Foerster Feather Reed Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004733.020.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karl Foerster Feather Reed Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004733.020.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karl Foerster Feather Reed Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004733.020.1",
    "locationcode": "J.05.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karl Foerster Feather Reed Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004733.030.1",
    "locationcode": "E.23.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karl Foerster Feather Reed Grass",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004733.030.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karl Foerster Feather Reed Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004733.030.1",
    "locationcode": "F.19.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karl Foerster Feather Reed Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004733.030.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karl Foerster Feather Reed Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004733.030.1",
    "locationcode": "G.19.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karl Foerster Feather Reed Grass",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004733.030.1",
    "locationcode": "H.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karl Foerster Feather Reed Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004733.030.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karl Foerster Feather Reed Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004733.030.1",
    "locationcode": "I.12.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karl Foerster Feather Reed Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004733.030.1",
    "locationcode": "J.05.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karl Foerster Feather Reed Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004737.010.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karley Rose Fountain Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004737.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karley Rose Fountain Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004737.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Karley Rose Fountain Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004740.013.1",
    "locationcode": "D.07.032",
    "plantgroupcode": "140_GRASS",
    "commonname": "Lemon Grass",
    "contsize": "1GP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004510.010.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Fountain Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004510.010.1",
    "locationcode": "I.09.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Fountain Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004510.030.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Fountain Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004510.030.1",
    "locationcode": "I.12.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Fountain Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001404.010.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Kitten Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001404.010.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Kitten Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001404.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Kitten Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001404.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Kitten Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001404.010.1",
    "locationcode": "I.09.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Kitten Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001404.020.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Kitten Maiden Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001404.020.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Kitten Maiden Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001404.020.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Kitten Maiden Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001404.030.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Kitten Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001404.030.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Kitten Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001404.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Kitten Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001404.030.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Kitten Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011077.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Red Fox Bluestem",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011077.020.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Red Fox Bluestem",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011077.030.1",
    "locationcode": "D.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Red Fox Bluestem",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001110.010.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Zebra Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001110.010.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Zebra Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001110.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Zebra Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001110.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Zebra Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001110.020.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Zebra Maiden Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001110.020.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Zebra Maiden Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001110.020.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Zebra Maiden Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001110.020.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Zebra Maiden Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001110.030.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Zebra Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001110.030.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Zebra Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001110.030.1",
    "locationcode": "G.19.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Zebra Maiden Grass",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001110.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Zebra Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001110.030.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Zebra Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001110.030.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Little Zebra Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000912.010.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Lord Snowden Big Bluestem",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000912.010.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Lord Snowden Big Bluestem",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000912.030.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Lord Snowden Big Bluestem",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "000912.030.1",
    "locationcode": "I.12.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Lord Snowden Big Bluestem",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011067.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Love and Rockets Fountain Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008631.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Lumen Gold Fountain Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008631.010.1",
    "locationcode": "I.09.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Lumen Gold Fountain Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008631.030.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Lumen Gold Fountain Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008631.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Lumen Gold Fountain Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004450.010.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004450.010.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004450.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004450.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004450.010.1",
    "locationcode": "I.09.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004450.020.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Maiden Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004450.020.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Maiden Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004450.020.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Maiden Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004450.020.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Maiden Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004450.030.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004450.030.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004450.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004450.030.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004450.050.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Maiden Grass",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004450.050.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Maiden Grass",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004450.050.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Maiden Grass",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004450.050.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Maiden Grass",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004419.010.1",
    "locationcode": "D.08.059",
    "plantgroupcode": "140_GRASS",
    "commonname": "Mexican Feather Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004419.010.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Mexican Feather Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004419.020.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Mexican Feather Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004700.007.1",
    "locationcode": "D.08.028",
    "plantgroupcode": "140_GRASS",
    "commonname": "Mondo Grass",
    "contsize": "QT",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004700.010.1",
    "locationcode": "C.09.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Mondo Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004700.010.1",
    "locationcode": "C.10.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Mondo Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004700.010.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Mondo Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001973.010.1",
    "locationcode": "C.19.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Northwind Switch Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001973.010.1",
    "locationcode": "D.25.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Northwind Switch Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001973.010.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Northwind Switch Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001973.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Northwind Switch Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001973.010.1",
    "locationcode": "H.10.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Northwind Switch Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001973.010.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Northwind Switch Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001973.020.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Northwind Switch Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001973.030.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Northwind Switch Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001973.030.1",
    "locationcode": "H.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Northwind Switch Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001973.030.1",
    "locationcode": "I.12.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Northwind Switch Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001973.050.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Northwind Switch Grass",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001973.050.1",
    "locationcode": "H.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Northwind Switch Grass",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001973.050.1",
    "locationcode": "I.12.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Northwind Switch Grass",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004422.030.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Overdam Feather Reed Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001800.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Pampas Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004254.030.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Pink Flamingos Muhly Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004254.030.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Pink Flamingos Muhly Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004254.030.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Pink Flamingos Muhly Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004254.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Pink Flamingos Muhly Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004254.030.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Pink Flamingos Muhly Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004457.020.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Porcupine Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004457.020.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Porcupine Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004457.020.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Porcupine Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004457.030.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Porcupine Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004457.030.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Porcupine Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004457.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Porcupine Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004457.030.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Porcupine Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003521.010.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Prairie Blues Little Bluestem",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003521.010.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Prairie Blues Little Bluestem",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003521.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Prairie Blues Little Bluestem",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003521.020.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Prairie Blues Little Bluestem",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003521.020.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Prairie Blues Little Bluestem",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003521.020.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Prairie Blues Little Bluestem",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003521.020.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Prairie Blues Little Bluestem",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003521.030.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Prairie Blues Little Bluestem",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003521.030.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Prairie Blues Little Bluestem",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003521.030.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Prairie Blues Little Bluestem",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003521.030.1",
    "locationcode": "I.12.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Prairie Blues Little Bluestem",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001360.010.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Prairie Dropseed",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001360.010.1",
    "locationcode": "D.25.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Prairie Dropseed",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001360.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Prairie Dropseed",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001360.010.1",
    "locationcode": "J.05.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Prairie Dropseed",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001360.030.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Prairie Dropseed",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001360.030.1",
    "locationcode": "H.10.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Prairie Dropseed",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001360.030.1",
    "locationcode": "H.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Prairie Dropseed",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001360.030.1",
    "locationcode": "I.12.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Prairie Dropseed",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "002497.020.1",
    "locationcode": "D.08.059",
    "plantgroupcode": "140_GRASS",
    "commonname": "Princess Ornamental Napier Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005693.011.1",
    "locationcode": "0.00.111",
    "plantgroupcode": "140_GRASS",
    "commonname": "Purple Explosion Liriope",
    "contsize": "#1D",
    "source": ""
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005693.011.1",
    "locationcode": "B.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Purple Explosion Liriope",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005693.011.1",
    "locationcode": "B.04.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Purple Explosion Liriope",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005693.011.1",
    "locationcode": "C.09.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Purple Explosion Liriope",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005693.011.1",
    "locationcode": "C.10.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Purple Explosion Liriope",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004730.007.1",
    "locationcode": "D.07.031",
    "plantgroupcode": "140_GRASS",
    "commonname": "Purple Fountain Grass",
    "contsize": "QT",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004730.010.1",
    "locationcode": "C.06.080",
    "plantgroupcode": "140_GRASS",
    "commonname": "Purple Fountain Grass",
    "contsize": "#1",
    "source": "TX"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004730.010.1",
    "locationcode": "D.08.058",
    "plantgroupcode": "140_GRASS",
    "commonname": "Purple Fountain Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004730.020.1",
    "locationcode": "C.11.031",
    "plantgroupcode": "140_GRASS",
    "commonname": "Purple Fountain Grass",
    "contsize": "#2",
    "source": "TX"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004730.020.1",
    "locationcode": "C.11.051",
    "plantgroupcode": "140_GRASS",
    "commonname": "Purple Fountain Grass",
    "contsize": "#2",
    "source": "TX"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004730.030.1",
    "locationcode": "C.11.050",
    "plantgroupcode": "140_GRASS",
    "commonname": "Purple Fountain Grass",
    "contsize": "#3",
    "source": "TX"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008344.011.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Red Head Fountain Grass",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008344.031.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Red Head Fountain Grass",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008344.031.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Red Head Fountain Grass",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004479.010.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Red Silver Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004479.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Red Silver Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004479.010.1",
    "locationcode": "J.05.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Red Silver Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004479.030.1",
    "locationcode": "G.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Red Silver Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004479.030.1",
    "locationcode": "H.13.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Red Silver Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004479.030.1",
    "locationcode": "I.12.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Red Silver Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004479.030.1",
    "locationcode": "J.05.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Red Silver Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011524.020.1",
    "locationcode": "D.08.058",
    "plantgroupcode": "140_GRASS",
    "commonname": "Regal Princess Fountain Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010539.010.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Rosy Muhly Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010539.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Rosy Muhly Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010539.010.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Rosy Muhly Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010539.030.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Rosy Muhly Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010539.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Rosy Muhly Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004424.010.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Shenandoah Switch Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004424.010.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Shenandoah Switch Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004424.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Shenandoah Switch Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004424.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Shenandoah Switch Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004424.020.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Shenandoah Switch Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004424.020.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Shenandoah Switch Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004424.020.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Shenandoah Switch Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004424.030.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Shenandoah Switch Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004424.030.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Shenandoah Switch Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004424.030.1",
    "locationcode": "G.19.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Shenandoah Switch Grass",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004424.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Shenandoah Switch Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004424.030.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Shenandoah Switch Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004743.010.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "The Blues Little Bluestem",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004743.010.1",
    "locationcode": "D.25.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "The Blues Little Bluestem",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004743.010.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "The Blues Little Bluestem",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004743.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "The Blues Little Bluestem",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004743.010.1",
    "locationcode": "J.05.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "The Blues Little Bluestem",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004455.030.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Variegated Japanese Silver Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004455.030.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Variegated Japanese Silver Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004455.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Variegated Japanese Silver Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004455.030.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Variegated Japanese Silver Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004380.007.1",
    "locationcode": "D.08.028",
    "plantgroupcode": "140_GRASS",
    "commonname": "Variegated Liriope",
    "contsize": "QT",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004380.010.1",
    "locationcode": "B.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Variegated Liriope",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004380.010.1",
    "locationcode": "B.04.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Variegated Liriope",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004380.010.1",
    "locationcode": "C.09.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Variegated Liriope",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004380.010.1",
    "locationcode": "C.10.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Variegated Liriope",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004380.010.1",
    "locationcode": "E.02.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Variegated Liriope",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004380.010.1",
    "locationcode": "E.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Variegated Liriope",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004380.010.1",
    "locationcode": "E.12.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Variegated Liriope",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004380.010.1",
    "locationcode": "E.17.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Variegated Liriope",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004489.010.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Yaku Jima Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004489.010.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Yaku Jima Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004489.010.1",
    "locationcode": "H.06.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Yaku Jima Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004489.010.1",
    "locationcode": "I.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Yaku Jima Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004489.010.1",
    "locationcode": "J.05.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Yaku Jima Maiden Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004489.020.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Yaku Jima Maiden Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004489.020.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Yaku Jima Maiden Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004489.020.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Yaku Jima Maiden Grass",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004489.030.1",
    "locationcode": "F.08.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Yaku Jima Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004489.030.1",
    "locationcode": "F.16.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Yaku Jima Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004489.030.1",
    "locationcode": "H.03.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Yaku Jima Maiden Grass",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011566.010.1",
    "locationcode": "D.19.000",
    "plantgroupcode": "140_GRASS",
    "commonname": "Zig Zag\u2122 Blue Grama Grass",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001058.013.1",
    "locationcode": "D.07.002",
    "plantgroupcode": "150_ANNUAL",
    "commonname": "Fiber Optic Grass",
    "contsize": "1GP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009681.013.1",
    "locationcode": "D.09.002",
    "plantgroupcode": "151_PEREN",
    "commonname": "Brise D'Anjou Variegated Jacob's Ladder",
    "contsize": "1GP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008634.013.1",
    "locationcode": "D.08.041",
    "plantgroupcode": "151_PEREN",
    "commonname": "Frostkiss\u00ae Anna's Red Hellebore",
    "contsize": "1GP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010747.013.1",
    "locationcode": "D.08.041",
    "plantgroupcode": "151_PEREN",
    "commonname": "FrostKiss\u2122 Penny's Pink\u00ae Hellebore",
    "contsize": "1GP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010417.013.1",
    "locationcode": "D.09.002",
    "plantgroupcode": "151_PEREN",
    "commonname": "Golden Feathers Jacob's Ladder",
    "contsize": "1GP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010417.013.1",
    "locationcode": "D.09.044",
    "plantgroupcode": "151_PEREN",
    "commonname": "Golden Feathers Jacob's Ladder",
    "contsize": "1GP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001806.081.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Apache Blackberry",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004219.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Arapaho Blackberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004219.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Arapaho Blackberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004219.081.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Arapaho Blackberry",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011785.031.1",
    "locationcode": "A.06.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Aurora Honeyberry",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003804.031.1",
    "locationcode": "D.11.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Bluecrop Blueberry",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003804.031.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Bluecrop Blueberry",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011787.031.1",
    "locationcode": "A.06.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Boreal Blizzard Honeyberry",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007925.031.1",
    "locationcode": "D.11.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Chandler Blueberry",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003811.031.1",
    "locationcode": "D.11.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Chippewa Blueberry",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003811.031.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Chippewa Blueberry",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003822.021.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Concord Seedless Grape",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003918.031.1",
    "locationcode": "D.11.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Duke Blueberry",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003918.031.1",
    "locationcode": "F.17.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Duke Blueberry",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "010717.031.1",
    "locationcode": "D.31.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Fall Gold Raspberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003816.021.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Fredonia Grape",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003541.031.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Heritage Raspberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003541.031.1",
    "locationcode": "I.09.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Heritage Raspberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003541.081.1",
    "locationcode": "D.13.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Heritage Raspberry",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003541.081.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Heritage Raspberry",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003755.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Jewel Black Raspberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003755.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Jewel Black Raspberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003755.081.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Jewel Black Raspberry",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003755.081.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Jewel Black Raspberry",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "004266.007.1",
    "locationcode": "D.08.034",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Jewel Strawberry",
    "contsize": "QT",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003658.011.1",
    "locationcode": "H.10.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Natchez Blackberry",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003658.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Natchez Blackberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003658.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Natchez Blackberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003658.081.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Natchez Blackberry",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005666.021.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Neptune Grape",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003818.021.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Niagara Grape",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003656.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Ouachita Blackberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "003656.081.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Ouachita Blackberry",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007619.031.1",
    "locationcode": "D.11.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Patriot Blueberry",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007619.031.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Patriot Blueberry",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007619.031.1",
    "locationcode": "F.17.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Patriot Blueberry",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011784.031.1",
    "locationcode": "A.06.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Polar Jewel Honeyberry",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005662.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Prime-Ark\u00ae 45 Blackberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005662.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Prime-Ark\u00ae 45 Blackberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005662.081.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Prime-Ark\u00ae 45 Blackberry",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008128.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Prime-Ark\u00ae Freedom Blackberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008128.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Prime-Ark\u00ae Freedom Blackberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008128.081.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Prime-Ark\u00ae Freedom Blackberry",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "005189.021.1",
    "locationcode": "D.18.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Reliance Pink Seedless Grape",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009394.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Sweet-Ark\u00ae Ponca Blackberry",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "009394.081.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "250_SM_FRU",
    "commonname": "Sweet-Ark\u00ae Ponca Blackberry",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001407.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "300_FRUIT",
    "commonname": "Brown Turkey Fig",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001407.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "300_FRUIT",
    "commonname": "Brown Turkey Fig",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001408.031.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "300_FRUIT",
    "commonname": "Celeste Fig",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001408.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "300_FRUIT",
    "commonname": "Celeste Fig",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "001408.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "300_FRUIT",
    "commonname": "Celeste Fig",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008299.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "300_FRUIT",
    "commonname": "Chicago Hardy Fig",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008299.031.1",
    "locationcode": "D.26.000",
    "plantgroupcode": "300_FRUIT",
    "commonname": "Chicago Hardy Fig",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007411.011.1",
    "locationcode": "H.10.000",
    "plantgroupcode": "300_FRUIT",
    "commonname": "Little Miss Figgy\u2122 Dwarf Fig",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007411.031.1",
    "locationcode": "D.21.000",
    "plantgroupcode": "300_FRUIT",
    "commonname": "Little Miss Figgy\u2122 Dwarf Fig",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007411.031.1",
    "locationcode": "D.22.000",
    "plantgroupcode": "300_FRUIT",
    "commonname": "Little Miss Figgy\u2122 Dwarf Fig",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "007411.031.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "300_FRUIT",
    "commonname": "Little Miss Figgy\u2122 Dwarf Fig",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008946.021.1",
    "locationcode": "C.06.073",
    "plantgroupcode": "300_FRUIT",
    "commonname": "Little Miss Figgy\u2122 Dwarf Fig Patio Tree",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "008946.031.1",
    "locationcode": "D.07.002",
    "plantgroupcode": "300_FRUIT",
    "commonname": "Little Miss Figgy\u2122 Dwarf Fig Patio Tree",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "assignedto": "murphy_stanley",
    "itemcode": "011284.070.1",
    "locationcode": "B.11.000",
    "plantgroupcode": "330_TREES",
    "commonname": "Purple Rain\u2122 Redbud Espalier",
    "contsize": "#7",
    "source": "BR"
  }
]$json$::jsonb) as x(
    assignedto text,
    itemcode text,
    locationcode text,
    plantgroupcode text,
    commonname text,
    contsize text,
    source text
);

create index on tmp_eval_exact_assignments (
    assignedto,
    pg_temp.tmp_eval_assignment_norm(itemcode),
    pg_temp.tmp_eval_assignment_norm(locationcode),
    pg_temp.tmp_eval_assignment_norm(plantgroupcode),
    pg_temp.tmp_eval_assignment_norm(commonname),
    pg_temp.tmp_eval_assignment_norm(contsize),
    pg_temp.tmp_eval_assignment_norm(source)
);

do $$
declare
    duplicate_summary text;
begin
    with normalized as (
        select
            assignedto,
            pg_temp.tmp_eval_assignment_norm(itemcode) as n_itemcode,
            pg_temp.tmp_eval_assignment_norm(locationcode) as n_locationcode,
            pg_temp.tmp_eval_assignment_norm(plantgroupcode) as n_plantgroupcode,
            pg_temp.tmp_eval_assignment_norm(commonname) as n_commonname,
            pg_temp.tmp_eval_assignment_norm(contsize) as n_contsize,
            pg_temp.tmp_eval_assignment_norm(source) as n_source,
            itemcode,
            locationcode,
            plantgroupcode,
            commonname,
            contsize,
            source
        from tmp_eval_exact_assignments
    ), duplicates as (
        select
            min(itemcode) as itemcode,
            min(locationcode) as locationcode,
            min(plantgroupcode) as plantgroupcode,
            min(commonname) as commonname,
            min(contsize) as contsize,
            min(source) as source,
            string_agg(distinct assignedto, ', ' order by assignedto) as assigned_users
        from normalized
        group by n_itemcode, n_locationcode, n_plantgroupcode, n_commonname, n_contsize, n_source
        having count(distinct assignedto) > 1
    )
    select string_agg(
        itemcode || ' | ' || locationcode || ' | ' || plantgroupcode || ' | ' || commonname || ' | ' || contsize || ' | ' || source || ' -> ' || assigned_users,
        '; '
        order by itemcode, locationcode, commonname
    )
    into duplicate_summary
    from duplicates;

    if duplicate_summary is not null then
        raise exception 'Duplicate exact EVAL assignment found: %', duplicate_summary;
    end if;
end $$;

-- Remove Ellen/Murphy only from rows that no longer match their exact assignment set.
update public.v2_master_inventory m
set assignedto = null
where lower(btrim(coalesce(m.assignedto, ''))) in ('ellen_ward', 'murphy_stanley')
  and not exists (
    select 1
    from tmp_eval_exact_assignments a
    where lower(btrim(a.assignedto)) = lower(btrim(coalesce(m.assignedto, '')))
      and pg_temp.tmp_eval_assignment_norm(m.itemcode) = pg_temp.tmp_eval_assignment_norm(a.itemcode)
      and pg_temp.tmp_eval_assignment_norm(m.locationcode) = pg_temp.tmp_eval_assignment_norm(a.locationcode)
      and pg_temp.tmp_eval_assignment_norm(m.plantgroupcode) = pg_temp.tmp_eval_assignment_norm(a.plantgroupcode)
      and pg_temp.tmp_eval_assignment_norm(m.commonname) = pg_temp.tmp_eval_assignment_norm(a.commonname)
      and pg_temp.tmp_eval_assignment_norm(m.contsize) = pg_temp.tmp_eval_assignment_norm(a.contsize)
      and pg_temp.tmp_eval_assignment_norm(m.source) = pg_temp.tmp_eval_assignment_norm(a.source)
  );

-- Assign Ellen/Murphy to the exact rows listed above.
update public.v2_master_inventory m
set assignedto = a.assignedto
from tmp_eval_exact_assignments a
where pg_temp.tmp_eval_assignment_norm(m.itemcode) = pg_temp.tmp_eval_assignment_norm(a.itemcode)
  and pg_temp.tmp_eval_assignment_norm(m.locationcode) = pg_temp.tmp_eval_assignment_norm(a.locationcode)
  and pg_temp.tmp_eval_assignment_norm(m.plantgroupcode) = pg_temp.tmp_eval_assignment_norm(a.plantgroupcode)
  and pg_temp.tmp_eval_assignment_norm(m.commonname) = pg_temp.tmp_eval_assignment_norm(a.commonname)
  and pg_temp.tmp_eval_assignment_norm(m.contsize) = pg_temp.tmp_eval_assignment_norm(a.contsize)
  and pg_temp.tmp_eval_assignment_norm(m.source) = pg_temp.tmp_eval_assignment_norm(a.source);

-- Optional verification after running:
-- select assignedto, count(*) as row_count
-- from public.v2_master_inventory
-- where lower(btrim(coalesce(assignedto, ''))) in ('ellen_ward', 'murphy_stanley')
-- group by assignedto
-- order by assignedto;

commit;
