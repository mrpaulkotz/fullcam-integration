export interface plantingDetails {
  plantingDate: number;
  plantingName: string;
}


export function generateEventQTemplate(details: plantingDetails): string {

const plantingDate = details.plantingDate;
const plantingName = details.plantingName || 'Unnamed planting';

const eventqEmpty = `<EventQ count="0">
      <HeaderState sortIx="0" sortUp="true" sortBy1="false" sortBy2="false" showOnlyHS="false">
        <headSectW>80,270,1339,270,270,0</headSectW>
      </HeaderState>
      <showEvT>t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,f</showEvT>
    </EventQ>`;

const eventqWithData = `<EventQ count="1">
    <Event tEV="PlnF" clearEV="false" onEV="true" dateOriginEV="Calendar" nYrsFromStEV="" nDaysFromStEV="" tFaqEV="Blank" tAaqEV="Blank" aqStYrEV="1990" aqEnYrEV="2100" nmEV="Establish environmental plantings - block geometry" categoryEV="CatUndef" tEvent="Doc" idSP="7" regimeInstance="fd726ee9-d483-4506-b5f9-c78fb7c52055" nmRegime="${plantingName}">
      <notesEV/>
      <PlnF tStemPlnF="Mass" agePlnF="0.3" stemVolPlnF="" stemMPlnF="0.087" branMPlnF="0.059" barkMPlnF="0.026" leafMPlnF="0.039" cortMPlnF="0.074" firtMPlnF="0.014" stemNCRatioPlnF="" branNCRatioPlnF="" barkNCRatioPlnF="" leafNCRatioPlnF="" cortNCRatioPlnF="" firtNCRatioPlnF="" storNMPlnF="" fixPlnF="" phaPlnF="" tTYFCat="BlockES" treeNmPlnF="Environmental plantings"/>
      <dateEV CalendarSystemT="FixedLength">${plantingDate}</dateEV>
    </Event>
    <HeaderState sortIx="0" sortUp="true" sortBy1="false" sortBy2="false" showOnlyHS="false">
      <headSectW>80,270,785,270,270,0</headSectW>
    </HeaderState>
    <showEvT>t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,t,f</showEvT>
  </EventQ>`;

    if (plantingDate) {
        return eventqWithData;
    } else {
        return eventqEmpty;
    }
}