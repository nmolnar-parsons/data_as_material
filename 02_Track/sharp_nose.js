// Use d3 to load prepared CSV, create visualization, and export


// Dimensions

    // Poster is  18x24 inches, which is a 3:4 aspect ratio. 
const viz_dimensions = {
    width: 1800,
    height: 2400,
    margin: {
        top: 100,
        bottom: 100,
        right: 300,
        left: 300
    }
}

// Create SVG canvas
const svg = d3.select("#viz")
    .append("svg")
    .attr("width", viz_dimensions.width)
    .attr("height", viz_dimensions.height)
    // center the SVG in the container
    .style("display", "block")
    .style("margin", "0 auto")
    .style("background-color", "#f9f9f9"); // light background for better contrast

// Load prepared CSV data
d3.csv("nosetouch_data_prepared_trimmed.csv").then(data => {
    console.log(data); // Check the loaded data
    
    //console log all locations in dataset
    const locations = Array.from(new Set(data.map(d => d.location)));
    console.log("Locations in dataset:", locations);

    // //Group data at the hour level
    // data.forEach(d => {
    //     d.datetime = new Date(d.datetime);
    //     d.hour = d3.timeHour(d.datetime); // Group by hour
    // });
    // console.log(data); // Check the data with hour grouping

    // // use hour for x-axis
    const x = d3.scaleTime()
        .domain(d3.extent(data, d => d.hour))
        .range([viz_dimensions.margin.left, viz_dimensions.width - viz_dimensions.margin.right]);

    // //alterantive x: using a lienar scale based 

    const y = d3.scaleOrdinal()
        .domain(["0", "1"])
        .range([viz_dimensions.height * 0.55, viz_dimensions.height * 0.45]); // Position at 30% and 70% of height



    // // //add jitter to y position to avoid overlap
    // // const jitter = 20;

    // // // Add points to the SVG
    // // svg.selectAll("circle")
    // //     .data(data)
    // //     .enter()
    // //     .append("circle")
    // //     .attr("cx", d => x(new Date(d.datetime)))
    // //     .attr("cy", d => y(d.side) + (Math.random() - 0.5) * jitter) // Add jitter to y position
    // //     .attr("r", 5)
    // //     .attr("fill", d => d.side === "0" ? "steelblue" : "coral");

    // // //draw x-axis
    // // const xAxis = d3.axisBottom(x)
    // //     // .ticks(d3.timeHour.every(1)) // Adjust ticks to every hour
    // //     // .tickFormat(d3.timeFormat("%H:%M")); // Format ticks as HH:MM

    // // svg.append("g")
    // //     .attr("transform", `translate(0, ${0.5*viz_dimensions.height})`)
    // //     .call(xAxis);

    // // new stuff here

    // // Group data by hour and side to stack overlapping points
    // const grouped = d3.group(data, d => `${d.hour.getTime()}-${d.side}`);
    
    // const stackOffset = 20; // Vertical offset between stacked points
    
    // // Add stacking index to each point
    // grouped.forEach(group => {
    //     group.forEach((d, i) => {
    //         d.stackIndex = i;
    //     });
    // });

    // // Add points to the SVG
    // svg.selectAll("circle")
    //     .data(data)
    //     .enter()
    //     .append("circle")
    //     .attr("cx", d => x(d.hour))
    //     .attr("cy", d => y(d.side) + (d.stackIndex * stackOffset)) // Stack overlapping points
    //     .attr("r", 5)
    //     .attr("fill", d => {
    //         if (d.side === "Right") return "red";      // Left is red
    //         if (d.side === "Left") return "blue";     // Right is blue
    //         return "purple";                        // N/A is purple
    //     })
    //     .attr("opacity", 0.7); // Slightly transparent for better visibility

    // Angular nose shape path

    data.forEach(d => {
        d.datetime = new Date(d.datetime);
        d.hour = d3.timeHour(d.datetime); // Group by hour
    });
    console.log(data); // Check the data with hour grouping

    // Create a scale for position along the diagonal
    const diagonalScale = d3.scaleTime()
        .domain(d3.extent(data, d => d.hour))
        .range([0, 1]); // 0 = start, 1 = end

    // Define angular nose shape points
    const noseStart = { x: viz_dimensions.width - viz_dimensions.margin.right, y: viz_dimensions.margin.top };
    const noseTurn = { x: viz_dimensions.margin.left, y: viz_dimensions.height * (2/3) }; // Sharp turn at bottom third
    const noseEnd = { x: viz_dimensions.width - viz_dimensions.margin.right, y: viz_dimensions.height * (2/3) }; // Horizontal to the right
    
    // Array of segments for the angular nose path
    const segments = [
        { start: noseStart, end: noseTurn, tStart: 0, tEnd: 0.5 }, // Diagonal from top right to middle left
        { start: noseTurn, end: noseEnd, tStart: 0.5, tEnd: 1.0 } // Horizontal from middle left to right
    ];
    
    // Function to get point along the angular path
    const getPointOnCurve = (t) => {
        // Find which segment t falls into
        let segment;
        if (t <= 0.5) {
            segment = segments[0];
        } else {
            segment = segments[1];
        }
        
        // Normalize t within the segment
        const segmentT = (t - segment.tStart) / (segment.tEnd - segment.tStart);
        
        // Linear interpolation along segment
        const x = segment.start.x + segmentT * (segment.end.x - segment.start.x);
        const y = segment.start.y + segmentT * (segment.end.y - segment.start.y);
        
        return { x, y };
    };
    
    // Function to get tangent (angle) at point on path for perpendicular offset
    const getTangentAtPoint = (t) => {
        // Find which segment t falls into
        let segment;
        if (t <= 0.5) {
            segment = segments[0];
        } else {
            segment = segments[1];
        }
        
        // Calculate angle of the segment
        const dx = segment.end.x - segment.start.x;
        const dy = segment.end.y - segment.start.y;
        const angle = Math.atan2(dy, dx);
        
        return angle;
    };

    // Calculate x,y position along path based on time
    const getDiagonalX = (d) => {
        const t = diagonalScale(d.hour);
        const point = getPointOnCurve(t);
        return point.x;
    };

    const getDiagonalY = (d) => {
        const t = diagonalScale(d.hour);
        const point = getPointOnCurve(t);
        return point.y;
    };

    // Offset perpendicular to path for left/right sides
    const perpendicularOffset = 20; // Distance from path line

    // Create color scale for location
    const locationColors = d3.scaleOrdinal()
        .domain(["Home", "Commute", "School", "Meal", "Gym", "Event"])
        .range(["#366EDE", "#951D12", "#3193AD", "#DB5E0C", "#19A851", "#F3C11B"]);
    
    // Create shape generator for part_of_body
    const bodyPartSymbol = d3.scaleOrdinal()
        .domain(["Hand", "Sleeve", "Shoulder", "Tongue"])
        .range([d3.symbolCircle, d3.symbolSquare, d3.symbolTriangle, d3.symbolDiamond]);
    
    // Create size scale for number_of_times
    const sizeScale = d3.scaleLinear()
        .domain([1, d3.max(data, d => +d.number_of_times)])
        .range([600, 1600]); // Size in square pixels for d3.symbol

    //create opacity scale for touch type
    const opacityScale = d3.scaleOrdinal()
        .domain(["Touch","Brush","Scratch","Pinch"])
        .range([0.5, 0.7, 0.9, 1.0]);

    // Group data by hour and side to stack overlapping points
    const grouped = d3.group(data, d => `${d.hour.getTime()}-${d.side}`);
    
    const stackOffset = 5; // Vertical offset between stacked points
    const jitter = 0; // add slight jitter to all points
    
    // Add stacking index to each point
    grouped.forEach(group => {
        group.forEach((d, i) => {
            d.stackIndex = i;
            d.jitterX = (Math.random() - 0.5) * jitter;
            d.jitterY = (Math.random() - 0.5) * jitter;
        });
    });

    // Add points to the SVG using path elements for different shapes
    svg.selectAll("path.datapoint")
        .data(data)
        .enter()
        .append("path")
        .attr("class", "datapoint")
        .attr("d", d => {
            const symbolType = d3.symbolCircle; // bodyPartSymbol(d.part_of_body) || d3.symbolCircle;
            const symbolSize = sizeScale(+d.number_of_times);
            return d3.symbol().type(symbolType).size(symbolSize)();
        })
        .attr("transform", d => {
            const t = diagonalScale(d.hour);
            const basePoint = getPointOnCurve(t);
            const angle = getTangentAtPoint(t);
            
            const baseX = basePoint.x;
            const baseY = basePoint.y;
            
            // Handle offset based on side (perpendicular to path segment)
            let offsetX = 0, offsetY = 0;
            if (d.side === "Left") {
                // Perpendicular to the left of the tangent
                offsetX = -perpendicularOffset * Math.sin(angle);
                offsetY = perpendicularOffset * Math.cos(angle);
            } else if (d.side === "Right") {
                // Perpendicular to the right of the tangent
                offsetX = perpendicularOffset * Math.sin(angle);
                offsetY = -perpendicularOffset * Math.cos(angle);
            }
            // If side is N/A (empty string), offsetX and offsetY remain 0
            
            // Stack along the perpendicular direction as well
            const stackDirection = d.side === "Left" ? -1 : (d.side === "Right" ? 1 : 0);
            const stackX = d.stackIndex * stackOffset * stackDirection * Math.sin(angle);
            const stackY = -d.stackIndex * stackOffset * stackDirection * Math.cos(angle);
            
            const finalX = baseX + offsetX + stackX + d.jitterX;
            const finalY = baseY + offsetY + stackY + d.jitterY;
            
            return `translate(${finalX}, ${finalY})`;
        })
        .attr("fill", d => locationColors(d.location))
        .attr("stroke", "black", "stroke-width", 10)
        // .attr("opacity", d => opacityScale(d.type));





    // Axis
    
    const diagonalAxis = svg.append("g")
        .attr("class", "diagonal-axis");

    // Draw the angular nose axis with sharp turn
    diagonalAxis.append("path")
        .attr("d", `M ${noseStart.x} ${noseStart.y} L ${noseTurn.x} ${noseTurn.y} L ${noseEnd.x} ${noseEnd.y}`)
        .attr("stroke", "black")
        .attr("stroke-width", 10)
        .attr("fill", "none");

    // Add ticks along the path at every midnight (00:00)
    // const tickTimes = d3.timeDay.range(
    //     d3.min(data, d => d.hour),
    //     d3.max(data, d => d.hour),
    //     1
    // );
    
    // console.log("Tick times:", tickTimes);
    // console.log("Number of ticks:", tickTimes.length);
    
    // tickTimes.forEach(tick => {
    //     const t = diagonalScale(tick);
    //     const point = getPointOnCurve(t);
    //     const angle = getTangentAtPoint(t);
        
    //     console.log("Tick:", tick, "t:", t, "x:", point.x, "y:", point.y);
        
    //     // Tick mark perpendicular to path segment
    //     const tickLength = 10;
    //     diagonalAxis.append("line")
    //         .attr("x1", point.x)
    //         .attr("y1", point.y)
    //         .attr("x2", point.x - tickLength * Math.sin(angle))
    //         .attr("y2", point.y + tickLength * Math.cos(angle))
    //         .attr("stroke", "black")
    //         .attr("stroke-width", 4);
        
    //     // Tick label
    //     const labelOffset = 20;
    //     diagonalAxis.append("text")
    //         .attr("x", point.x - labelOffset * Math.sin(angle))
    //         .attr("y", point.y + labelOffset * Math.cos(angle))
    //         .attr("text-anchor", "middle")
    //         .attr("font-size", "20px")
    //         .text(d3.timeFormat("%b %d")(tick))
    //         .attr("transform", `rotate(${angle * 180 / Math.PI}, ${point.x - labelOffset * Math.sin(angle)}, ${point.y + labelOffset * Math.cos(angle)})`);
    // });

});


